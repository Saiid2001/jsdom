"use strict";

const parse5 = require("parse5");

const { createElement } = require("../../living/helpers/create-element");
const { HTML_NS } = require("../../living/helpers/namespaces");

const DocumentType = require("../../living/generated/DocumentType");
const DocumentFragment = require("../../living/generated/DocumentFragment");
const Text = require("../../living/generated/Text");
const Comment = require("../../living/generated/Comment");

const attributes = require("../../living/attributes");
const nodeTypes = require("../../living/node-type");
const { asciiLowercase } = require("../../living/helpers/strings");
const { deliverPendingMutationRecords } = require("../../living/helpers/mutation-observers");

const serializationAdapter = require("../../living/domparsing/parse5-adapter-serialization");
const {
  customElementReactionsStack, invokeCEReactions, lookupCEDefinition
} = require("../../living/helpers/custom-elements");


class JSDOMParse5Adapter {
  constructor(documentImpl, options = {}) {
    this._documentImpl = documentImpl;
    this._globalObject = documentImpl._globalObject;
    this._fragment = options.fragment || false;
    // Markup document.write() hands in is parsed as a fragment too, and its scripts do run.
    this._writtenMarkup = options.writtenMarkup || false;
    // https://html.spec.whatwg.org/multipage/parsing.html#parser-allow-declarative-shadow-roots
    this._allowDeclarativeShadowRoots = options.allowDeclarativeShadowRoots || false;

    // Since the createElement hook doesn't provide the parent element, we keep track of this using _currentElement:
    // https://github.com/inikulin/parse5/issues/285.
    this._currentElement = undefined;
  }

  _ownerDocument() {
    const { _currentElement } = this;

    // The _currentElement is undefined when parsing elements at the root of the document.
    if (_currentElement) {
      return _currentElement.localName === "template" && _currentElement.namespaceURI === HTML_NS ?
        _currentElement.content._ownerDocument :
        _currentElement._ownerDocument;
    }

    return this._documentImpl;
  }

  createDocument() {
    // parse5's model assumes that parse(html) will call into here to create the new Document, then return it. However,
    // jsdom's model assumes we can create a Window (and through that create an empty Document), do some other setup
    // stuff, and then parse, stuffing nodes into that Document as we go. So to adapt between these two models, we just
    // return the already-created Document when asked by parse5 to "create" a Document.
    return this._documentImpl;
  }

  createDocumentFragment() {
    const ownerDocument = this._ownerDocument();
    return DocumentFragment.createImpl(this._globalObject, [], { ownerDocument });
  }

  // https://html.spec.whatwg.org/#create-an-element-for-the-token
  createElement(localName, namespace, attrs) {
    const ownerDocument = this._ownerDocument();

    const isAttribute = attrs.find(attr => attr.name === "is");
    const isValue = isAttribute ? isAttribute.value : null;

    const definition = lookupCEDefinition(ownerDocument, namespace, localName, isValue);

    let willExecuteScript = false;
    if (definition !== null && !this._fragment) {
      willExecuteScript = true;
    }

    if (willExecuteScript) {
      deliverPendingMutationRecords();
      ownerDocument._throwOnDynamicMarkupInsertionCounter++;
      customElementReactionsStack.push([]);
    }

    const element = createElement(ownerDocument, localName, namespace, null, isValue, willExecuteScript);
    this.adoptAttributes(element, attrs);

    if (willExecuteScript) {
      const queue = customElementReactionsStack.pop();
      invokeCEReactions(queue);
      ownerDocument._throwOnDynamicMarkupInsertionCounter--;
      ownerDocument._constructedSinceLastScript = true;
    }

    if (this._documentParser) {
      element._parserOpen = true;
    }

    if ("_parserInserted" in element) {
      element._parserInserted = true;
      element._nonBlocking = false;
      // A fragment's scripts never run, and nor do their clones.
      // https://html.spec.whatwg.org/multipage/parsing.html#scriptEndTag
      if (this._fragment && !this._writtenMarkup) {
        element._alreadyStarted = true;
      }
    }

    // https://html.spec.whatwg.org/multipage/semantics.html#contributes-a-script-blocking-style-sheet
    if (this._documentParser && namespace === HTML_NS && (localName === "link" || localName === "style")) {
      element._createdByParser = true;
    }

    return element;
  }

  createCommentNode(data) {
    const ownerDocument = this._ownerDocument();
    return Comment.createImpl(this._globalObject, [], { data, ownerDocument });
  }

  appendChild(parentNode, newNode) {
    this._insertElement(() => parentNode._append(newNode));
  }

  insertBefore(parentNode, newNode, referenceNode) {
    this._insertElement(() => parentNode._insert(newNode, referenceNode));
  }

  // The reactions an insertion queues, connectedCallback among them, run as the parser inserts the element rather
  // than in a microtask after it.
  // https://html.spec.whatwg.org/multipage/parsing.html#insert-an-element-at-the-adjusted-insertion-location
  _insertElement(insert) {
    if (this._fragment) {
      insert();
      return;
    }

    customElementReactionsStack.push([]);
    try {
      insert();
    } finally {
      invokeCEReactions(customElementReactionsStack.pop());
    }
  }

  setTemplateContent(templateElement, contentFragment) {
    // This code makes the glue between jsdom and parse5 HTMLTemplateElement parsing:
    //
    // * jsdom during the construction of the HTMLTemplateElement (for example when create via
    //   `document.createElement("template")`), creates a DocumentFragment and set it into _templateContents.
    // * parse5 when parsing a <template> tag creates an HTMLTemplateElement (`createElement` adapter hook) and also
    //   create a DocumentFragment (`createDocumentFragment` adapter hook).
    //
    // At this point we now have to replace the one created in jsdom with one created by parse5.
    const { _ownerDocument, _host } = templateElement._templateContents;
    contentFragment._ownerDocument = _ownerDocument;
    contentFragment._host = _host;

    templateElement._templateContents = contentFragment;
  }

  setDocumentType(document, name, publicId, systemId) {
    const ownerDocument = this._ownerDocument();
    const documentType = DocumentType.createImpl(this._globalObject, [], { name, publicId, systemId, ownerDocument });

    document._append(documentType);
  }

  setDocumentMode(document, mode) {
    // TODO: the rest of jsdom ignores this
    document._mode = mode;
  }

  detachNode(node) {
    node.remove();
  }

  insertText(parentNode, text) {
    const { lastChild } = parentNode;
    if (lastChild && lastChild.nodeType === nodeTypes.TEXT_NODE) {
      lastChild.data += text;
    } else {
      const ownerDocument = this._ownerDocument();
      const textNode = Text.createImpl(this._globalObject, [], { data: text, ownerDocument });
      parentNode._append(textNode);
    }
  }

  insertTextBefore(parentNode, text, referenceNode) {
    const { previousSibling } = referenceNode;
    if (previousSibling && previousSibling.nodeType === nodeTypes.TEXT_NODE) {
      previousSibling.data += text;
    } else {
      const ownerDocument = this._ownerDocument();
      const textNode = Text.createImpl(this._globalObject, [], { data: text, ownerDocument });
      parentNode._append(textNode, referenceNode);
    }
  }

  adoptAttributes(element, attrs) {
    for (const attr of attrs) {
      const prefix = attr.prefix === "" ? null : attr.prefix;
      attributes.setAttributeValue(element, attr.name, attr.value, prefix, attr.namespace);
    }
  }

  onItemPush(after) {
    this._currentElement = after;
    after._pushedOnStackOfOpenElements?.();
  }

  onItemPop(before, newTop) {
    this._currentElement = newTop;
    before._parserOpen = false;

    // The document's parser prepares a script once the character that popped it has been handled -- after "switch
    // the insertion mode to the original insertion mode", and with the tokenizer back in the data state -- so that
    // markup the script writes is parsed from where the script ends, not inside its end tag.
    // https://html.spec.whatwg.org/multipage/parsing.html#scriptEndTag
    if (this._handlerDepth > 0 && before._localName === "script" && before._namespaceURI === HTML_NS) {
      this._poppedScripts.push(before);
      return;
    }

    this._popped(before);
  }

  _popped(element) {
    element._poppedOffStackOfOpenElements?.();
    this._onPopped?.(element);
  }
}

// Assign shared adapters with serializer.
Object.assign(JSDOMParse5Adapter.prototype, serializationAdapter);

// The shadow root a <template shadowrootmode> start tag attaches to `host`, or null where the template stays a
// template: no valid mode, a host that already has a root, or one that cannot take one. Steps 14 "Keep" 1.2–1.9 of
// https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inhead, for a start tag whose tag name is
// "template".
function attachDeclarativeShadowRoot(host, template) {
  const mode = asciiLowercase(attributes.getAttributeValue(template, "shadowrootmode") ?? "");
  if (mode !== "open" && mode !== "closed") {
    return null;
  }

  if (host.nodeType !== nodeTypes.ELEMENT_NODE || host._shadowRoot !== null) {
    return null;
  }

  const slotAssignment = asciiLowercase(attributes.getAttributeValue(template, "shadowrootslotassignment") ?? "");

  try {
    host._attachShadowRoot({
      mode,
      delegatesFocus: attributes.hasAttributeByName(template, "shadowrootdelegatesfocus"),
      serializable: attributes.hasAttributeByName(template, "shadowrootserializable"),
      slotAssignment: slotAssignment === "manual" ? "manual" : "named",
      clonable: attributes.hasAttributeByName(template, "shadowrootclonable")
    });
  } catch {
    // The spec lets a parser report this to the developer console; a page sees only the template left in place.
    return null;
  }

  const shadow = host._shadowRoot;
  shadow._availableToElementInternals = true;
  shadow._declarative = true;
  return shadow;
}

// parse5's parser, with declarative shadow DOM. A template that attaches a shadow root is pushed onto the stack of
// open elements but never inserted, and its template contents are the shadow root, so everything parsed until its
// end tag lands in the shadow tree; the end tag needs nothing more than parse5 already does.
class JSDOMParser extends parse5.Parser {
  _insertTemplate(token) {
    // The current node, not the adjusted current node: in the fragment case a top-level template never attaches a
    // shadow root to the context element.
    const host = this.openElements.current;
    const hostIsRoot = this.openElements.stackTop === 0;

    const template = this.treeAdapter.createElement(token.tagName, HTML_NS, token.attrs);
    this.treeAdapter.setTemplateContent(template, this.treeAdapter.createDocumentFragment());

    const shadow = this.treeAdapter._allowDeclarativeShadowRoots && !hostIsRoot ?
      attachDeclarativeShadowRoot(host, template) :
      null;

    if (shadow) {
      template._templateContents = shadow;
    } else {
      this._attachElementToTree(template, token.location);
    }

    this.openElements.push(template, token.tagID);
  }
}

// `allowDeclarativeShadowRoots` is false for innerHTML and the like, and true for setHTMLUnsafe().
function parseFragment(markup, contextElement, { allowDeclarativeShadowRoots = false, writtenMarkup = false } = {}) {
  const ownerDocument = contextElement.localName === "template" && contextElement.namespaceURI === HTML_NS ?
    contextElement.content._ownerDocument :
    contextElement._ownerDocument;

  const config = {
    ...ownerDocument._parseOptions,
    sourceCodeLocationInfo: false,
    treeAdapter: new JSDOMParse5Adapter(ownerDocument, { fragment: true, allowDeclarativeShadowRoots, writtenMarkup })
  };

  const parser = JSDOMParser.getFragmentParser(contextElement, config);
  parser.tokenizer.write(markup, true);
  return parser.getFragment();
}

// `allowDeclarativeShadowRoots` defaults to the document's own opt-in: true for a document loaded in a window and for
// Document.parseHTMLUnsafe(), false for DOMParser, XHR's responseXML and the other documents made without one.
function parseIntoDocument(
  markup,
  ownerDocument,
  { allowDeclarativeShadowRoots = ownerDocument._allowDeclarativeShadowRoots } = {}
) {
  const config = {
    ...ownerDocument._parseOptions,
    treeAdapter: new JSDOMParse5Adapter(ownerDocument, { allowDeclarativeShadowRoots })
  };

  return JSDOMParser.parse(markup, config);
}

// The document a window loads, parsed the way a browser's parser meets a parser-blocking script: a script that cannot
// run at its end tag -- its fetch still pending, or a script before it -- stops the tokenizer, which picks up again
// once the document's queue has run that script. Everything the script reads is the document as far as itself, and a
// custom element it defines is defined before the parser creates the element. `onParsed` runs once the input is
// parsed to its end, which is where the caller closes the document.
// https://html.spec.whatwg.org/multipage/parsing.html#scriptEndTag
function parseIntoLoadingDocument(markup, ownerDocument, onParsed) {
  const treeAdapter = new JSDOMParse5Adapter(ownerDocument, {
    allowDeclarativeShadowRoots: ownerDocument._allowDeclarativeShadowRoots
  });
  const parser = new JSDOMParser({ ...ownerDocument._parseOptions, treeAdapter });
  const { tokenizer } = parser;
  const queue = ownerDocument._queue;
  treeAdapter._documentParser = true;
  treeAdapter._handlerDepth = 0;
  treeAdapter._poppedScripts = [];
  ownerDocument._parsing = true;
  // Where document.write() inserts into the input stream while a parser-inserted script runs.
  ownerDocument._documentParserTokenizer = tokenizer;

  const parsed = () => {
    ownerDocument._parsing = false;
    ownerDocument._documentParserTokenizer = null;
    onParsed();
  };

  // The script itself, or one it wrote into the document, may still have to run.
  treeAdapter._onPopped = element => {
    if (element.localName !== "script" || element.namespaceURI !== HTML_NS || !queue.getLastScript()) {
      return;
    }

    tokenizer.pause();

    // Behind the script in the queue, so it runs once the script has. A document torn down meanwhile stays where
    // it stopped.
    queue.push(null, () => {
      if (ownerDocument._defaultView && tokenizer.paused) {
        tokenizer.resume(parsed);
      }
    });
  };

  // Scripts popped while the tokenizer handles a character are prepared once it has handled it.
  const callState = tokenizer._callState;
  tokenizer._callState = function (cp) {
    treeAdapter._handlerDepth++;
    try {
      callState.call(this, cp);
    } finally {
      treeAdapter._handlerDepth--;
    }

    if (treeAdapter._handlerDepth === 0 && treeAdapter._poppedScripts.length) {
      for (const element of treeAdapter._poppedScripts.splice(0)) {
        treeAdapter._popped(element);
      }
    }
  };

  tokenizer.write(markup, true, parsed);
}

module.exports = {
  parseFragment,
  parseIntoDocument,
  parseIntoLoadingDocument
};
