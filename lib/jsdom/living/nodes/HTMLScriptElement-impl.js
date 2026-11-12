"use strict";
const vm = require("vm");
const whatwgEncoding = require("whatwg-encoding");
const MIMEType = require("whatwg-mimetype");
const { serializeURL } = require("whatwg-url");

const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const DOMTokenList = require("../generated/DOMTokenList");
const reportException = require("../helpers/runtime-script-errors");
const { fireAnEvent } = require("../helpers/events");
const { domSymbolTree, cloningSteps } = require("../helpers/internal-constants");
const { asciiLowercase } = require("../helpers/strings");
const { childTextContent } = require("../helpers/text");
const { parseURLToResultingURLRecord } = require("../helpers/document-base-url");
const nodeTypes = require("../node-type");
const Request = require("../generated/Request");
const { hasModuleEvaluator, runModuleScript } = require("../helpers/module-scripts");

const jsMIMETypes = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript"
]);

class HTMLScriptElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);
    this._alreadyStarted = false;
    this._parserInserted = false; // set by the parser
    // The spec's "force async": a script made by script is async until told otherwise. The parser clears it.
    this._nonBlocking = true;
  }

  // https://html.spec.whatwg.org/multipage/scripting.html#dom-script-async
  get async() {
    return this._nonBlocking || this.hasAttributeNS(null, "async");
  }

  set async(value) {
    this._nonBlocking = false;
    if (value) {
      this.setAttributeNS(null, "async", "");
    } else {
      this.removeAttributeNS(null, "async");
    }
  }

  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#blocking-attributes
  get blocking() {
    if (this._blockingList === undefined) {
      this._blockingList = DOMTokenList.createImpl(this._globalObject, [], {
        element: this,
        attributeLocalName: "blocking",
        supportedTokens: new Set(["render"])
      });
    }
    return this._blockingList;
  }

  // In our current terribly-hacky document.write() implementation, we parse in a div them move elements into the main
  // document. Thus _eval() will bail early when it gets in _poppedOffStackOfOpenElements(), since we're not attached
  // then. Instead, we'll let it eval here.
  // https://html.spec.whatwg.org/multipage/scripting.html#script-processing-model:html-element-post-connection-steps
  _postConnectionSteps() {
    if (!this._parserInserted || this._isMovingDueToDocumentWrite) {
      this._eval();
    }
  }

  _canRunScript() {
    const document = this._ownerDocument;
    // Equivalent to the spec's "scripting is disabled" check.
    if (!document._defaultView || document._defaultView._runScripts !== "dangerously" || document._scriptingDisabled) {
      return false;
    }

    return true;
  }

  _fetchExternalScript() {
    const document = this._ownerDocument;
    const resourceLoader = document._resourceLoader;
    const defaultEncoding = whatwgEncoding.labelToName(this.getAttributeNS(null, "charset")) || document._encoding;
    let request;

    if (!this._canRunScript()) {
      return;
    }

    const src = this.getAttributeNS(null, "src");
    const url = parseURLToResultingURLRecord(src, this._ownerDocument);
    if (url === null) {
      return;
    }
    const urlString = serializeURL(url);

    const onLoadExternalScript = data => {
      const { response } = request;
      let contentType;

      if (response && response.statusCode !== undefined && response.statusCode >= 400) {
        throw new Error("Status code: " + response.statusCode);
      }

      if (response) {
        contentType = MIMEType.parse(response.headers["content-type"]) || new MIMEType("text/plain");
      }

      const encoding = whatwgEncoding.getBOMEncoding(data) ||
        (contentType && whatwgEncoding.labelToName(contentType.parameters.get("charset"))) ||
        defaultEncoding;
      const script = whatwgEncoding.decode(data, encoding);

      this._innerEval(script, urlString);
    };

    request = resourceLoader.fetch(urlString, {
      element: this,
      onLoad: onLoadExternalScript
    });
  }

  _fetchInternalScript() {
    const document = this._ownerDocument;

    if (!this._canRunScript()) {
      return;
    }

    // An inline script inserted by script runs at once, whatever the parser is waiting for.
    if (!this._parserInserted) {
      this._innerEval(this.text, document.URL);
      return;
    }

    // The parser performs a microtask checkpoint before a script it meets; that is only observable where a custom
    // element constructor it ran since the last one queued microtasks, so only then does the script wait a microtask
    // turn, behind them.
    // https://html.spec.whatwg.org/multipage/parsing.html#scriptEndTag
    let checkpoint = null;
    if (document._constructedSinceLastScript) {
      document._constructedSinceLastScript = false;
      checkpoint = Promise.resolve();
    }

    document._queue.push(checkpoint, () => {
      this._innerEval(this.text, document.URL);
    }, null, false, this);
  }

  // The entry module. Only this one is fetched here: its imports are addresses
  // the loader resolves and fetches itself, so the graph goes out the way the
  // host sends everything else rather than through two different paths.
  _fetchModuleScript() {
    const document = this._ownerDocument;

    if (!this._canRunScript()) {
      return;
    }

    // A module is deferred whether or not it says so: it runs once the document
    // is parsed, and in the order the elements appear. The queue is what holds
    // that order.
    // What the loader reaches the rest of the graph with.
    //
    // The window's loader, not the document's: the document's enqueues what it
    // fetches, and these are fetched from inside a queue entry that is waiting
    // for them, which deadlocks — the entry cannot finish until the imports
    // arrive and they cannot start until it finishes.
    //
    // Bytes rather than a response, too. A response body is read once, and the
    // loader hands every concurrent caller of one address the same response, so
    // the second module to read it finds it already consumed.
    const loader = document._defaultView && document._defaultView._resourceLoader;

    const fetchText = address => new Promise((resolve, reject) => {
      let pending;

      if (!loader) {
        reject(new Error("No resource loader to fetch a module with"));
        return;
      }

      try {
        pending = loader.fetch(address, {
          cookieJar: document._cookieJar,
          referrer: document.URL,
        });
      } catch (error) {
        reject(error);
        return;
      }

      if (!pending) {
        reject(new Error(`Could not request module ${address}`));
        return;
      }

      pending.then(data => {
        // A response that is not ok is a failed fetch, whatever its body.
        const statusCode = pending.response ? pending.response.statusCode : undefined;
        if (typeof statusCode === "number" && (statusCode < 200 || statusCode > 299)) {
          reject(new Error(`Module ${address} was answered ${statusCode}`));
          return;
        }

        const encoding = whatwgEncoding.getBOMEncoding(data) || document._encoding;

        resolve(whatwgEncoding.decode(data, encoding));
      }, reject);
    });

    // Fetching starts now; running waits its turn. A browser does both: the
    // graph is fetched as soon as the element is seen, in parallel with
    // everything else, and evaluated once the document is parsed, in document
    // order with the deferred classic scripts around it. Evaluated as soon as
    // the bytes arrived, lichess's first module extended a `$` that its own
    // deferred script had not defined yet.
    const prepare = (source, urlString) => {
      const window = document._global;

      return Promise.resolve()
        .then(() => runModuleScript(source, urlString, window, fetchText))
        .then(run => () => {
          document._currentScript = this;

          try {
            run();
          } catch (error) {
            reportException(window, error, urlString);
          } finally {
            document._currentScript = null;
          }
        }, error => {
          // A graph that could not be fetched fires error at its element when its turn to run comes; one that fails
          // to parse or link reaches the page the way a throwing script does. Either way it must not reject, or the
          // rest of the queue stops behind it. The evaluator marks a failed fetch with `fetchFailed`.
          // https://html.spec.whatwg.org/multipage/scripting.html#execute-the-script-element
          if (error && error.fetchFailed) {
            return () => fireAnEvent("error", this);
          }

          reportException(window, error, urlString);
          return () => { /* nothing to run */ };
        });
    };

    // The defer queue, not the ordinary one: it is where a deferred classic
    // script runs, so the two keep their document order, and it is what
    // DOMContentLoaded waits on — which pages bootstrap from, expecting what
    // the modules defined to be there already.
    const queueModule = (source, urlString) => {
      document._deferQueue.push(prepare(source, urlString), run => run(), null, false, this);
    };

    // Queued as the request itself rather than as work to do when the queue
    // reaches it. Pushed with no request, the queue runs the callback at once
    // and drops what it answers with when nothing else is outstanding — so the
    // graph was still loading when the queue emptied and DOMContentLoaded
    // fired. Queued this way the tail holds until the promise settles, which is
    // what makes a module run before that event the way a deferred script does.
    if (!this.hasAttributeNS(null, "src")) {
      // An inline module resolves its imports against the document.
      queueModule(childTextContent(this), document.URL);
      return;
    }

    const url = parseURLToResultingURLRecord(this.getAttributeNS(null, "src"), document);

    if (url === null) {
      return;
    }

    const urlString = serializeURL(url);

    // The entry is fetched by the loader as well, rather than here and handed
    // over: a page that lists its whole graph as entries — which is what a
    // code-split bundle looks like — names the same file both as an entry and
    // as somebody's import, and fetching it on both paths at once asks the
    // resource loader for one address twice over. The loader keeps a module per
    // address, so going through it is what makes that one request.
    //
    queueModule(undefined, urlString);
  }

  _attrModified(name, value, oldValue) {
    super._attrModified(name, value, oldValue);

    if (name === "async" && value !== null) {
      this._nonBlocking = false;
    }

    if (name === "blocking" && this._blockingList !== undefined) {
      this._blockingList.attrModified();
    }

    if (this._attached && !this._startedEval && name === "src" && oldValue === null && value !== null) {
      this._fetchExternalScript();
    }
  }

  _poppedOffStackOfOpenElements() {
    // This seems to roughly correspond to
    // https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-incdata:prepare-a-script, although we certainly
    // don't implement the full semantics.
    this._eval();
  }

  // Vaguely similar to https://html.spec.whatwg.org/multipage/scripting.html#prepare-a-script, but we have a long way
  // to go before it's aligned.
  _eval() {
    if (this._alreadyStarted) {
      return;
    }

    // TODO: this text check doesn't seem completely the same as the spec, which e.g. will try to execute scripts with
    // child element nodes. Spec bug? https://github.com/whatwg/html/issues/3419
    if (!this.hasAttributeNS(null, "src") && this.text.length === 0) {
      return;
    }

    if (!this._attached) {
      return;
    }

    const scriptBlocksTypeString = this._getTypeString();
    const type = getType(scriptBlocksTypeString);

    if (type === "module") {
      // A module needs a loader — a graph to resolve, fetch and evaluate in
      // order — which this library does not have. With one installed it is
      // handed the entry and finds the rest itself; with none the script is
      // dropped, as every non-classic script always was.
      if (!hasModuleEvaluator()) {
        return;
      }

      this._alreadyStarted = true;
      this._fetchModuleScript();
      return;
    }

    if (type !== "classic") {
      return;
    }

    // A browser that runs modules ignores the fallback written for one that
    // does not; running both means running the page's code twice. Only honoured
    // when modules are actually available, which is the order the spec asks for.
    if (hasModuleEvaluator() && this.hasAttributeNS(null, "nomodule")) {
      return;
    }

    this._alreadyStarted = true;

    // At this point we completely depart from the spec.

    if (this.hasAttributeNS(null, "src")) {
      this._fetchExternalScript();
    } else {
      this._fetchInternalScript();
    }
  }

  _innerEval(text, filename) {
    this._ownerDocument._writeAfterElement = this;
    processJavaScript(this, text, filename);
    delete this._ownerDocument._writeAfterElement;
  }

  _getTypeString() {
    const typeAttr = this.getAttributeNS(null, "type");
    const langAttr = this.getAttributeNS(null, "language");

    if (typeAttr === "") {
      return "text/javascript";
    }

    if (typeAttr === null && langAttr === "") {
      return "text/javascript";
    }

    if (typeAttr === null && langAttr === null) {
      return "text/javascript";
    }

    if (typeAttr !== null) {
      return typeAttr.trim();
    }

    if (langAttr !== null) {
      return "text/" + langAttr;
    }

    return null;
  }

  get text() {
    return childTextContent(this);
  }

  set text(text) {
    this.textContent = text;
  }

  // https://html.spec.whatwg.org/multipage/scripting.html#script-processing-model
  [cloningSteps](copy, node) {
    copy._alreadyStarted = node._alreadyStarted;
  }
}

function processJavaScript(element, code, filename) {
  const document = element.ownerDocument;
  const window = document && document._global;

  if (window) {
    document._currentScript = element;

    let lineOffset = 0;
    if (!element.hasAttributeNS(null, "src")) {
      for (const child of domSymbolTree.childrenIterator(element)) {
        if (child.nodeType === nodeTypes.TEXT_NODE) {
          if (child.sourceCodeLocation) {
            lineOffset = child.sourceCodeLocation.startLine - 1;
          }
          break;
        }
      }
    }

    // The source is handed over unaltered.
    //
    // It used to be rewritten: every `window`, `globalThis`, `document`,
    // `location` and `navigator` was renamed to a binding on the context,
    // because a bare name in a script resolves against the realm it is
    // evaluated in, and that realm is not this window. A regular expression
    // cannot tell those names apart from the same letters inside a string, a
    // property, or an object key, and each miss was a bug of its own: "this"
    // renamed broke every prototype-style script (C-01), the right hand side of
    // a dot broke property reads (C-02), and the class name "cc-window" in
    // cookieconsent's own markup became "cc-_jsdomWindow", so its stylesheet
    // matched nothing and its dismiss button did nothing (C-69).
    //
    // The host application is responsible for evaluating the code with this
    // window at the front of the scope chain, which resolves those names
    // without touching a character of the source.
    const translatedCode = code;

    try {
      vm.runInContext(translatedCode, window._jsContext, { filename, lineOffset });
    } catch (e) {
      console.error(e);
      reportException(window, e, filename); 
    } finally {
      document._currentScript = null;
    }
  }
}

function getType(typeString) {
  const lowercased = asciiLowercase(typeString);
  // Cannot use whatwg-mimetype parsing because that strips whitespace. The spec demands a strict string comparison.
  // That is, the type="" attribute is not really related to MIME types at all.
  if (jsMIMETypes.has(lowercased)) {
    return "classic";
  }
  if (lowercased === "module") {
    return "module";
  }
  return null;
}

module.exports = {
  implementation: HTMLScriptElementImpl
};
