"use strict";
const { addNwsapi } = require("../helpers/selectors");
const { HTML_NS } = require("../helpers/namespaces");
const { mixin, memoizeQuery } = require("../../utils");
const idlUtils = require("../generated/utils");
const NodeImpl = require("./Node-impl").implementation;
const ParentNodeImpl = require("./ParentNode-impl").implementation;
const ChildNodeImpl = require("./ChildNode-impl").implementation;
const attributes = require("../attributes");
const namedPropertiesWindow = require("../named-properties-window");
const namedPropertiesDocument = require("../named-properties-document");
const NODE_TYPE = require("../node-type");
const { parseFragment } = require("../../browser/parser");
const InnerHTMLImpl = require("../domparsing/InnerHTML-impl").implementation;
const { fragmentSerialization } = require("../domparsing/serialization");
const { domSymbolTree } = require("../helpers/internal-constants");
const DOMException = require("../generated/DOMException");
const DOMTokenList = require("../generated/DOMTokenList");
const NamedNodeMap = require("../generated/NamedNodeMap");
const validateNames = require("../helpers/validate-names");
const { asciiLowercase, asciiUppercase } = require("../helpers/strings");
const { listOfElementsWithQualifiedName, listOfElementsWithNamespaceAndLocalName,
  listOfElementsWithClassNames } = require("../node");
const SlotableMixinImpl = require("./Slotable-impl").implementation;
const NonDocumentTypeChildNode = require("./NonDocumentTypeChildNode-impl").implementation;
const ShadowRoot = require("../generated/ShadowRoot");
const Text = require("../generated/Text");
const { isValidHostElementName } = require("../helpers/shadow-dom");
const { isValidCustomElementName, lookupCEDefinition } = require("../helpers/custom-elements");
const { borderBoxOf } = require("../helpers/layout-geometry");
const { elementScrolled } = require("../helpers/element-scroll");
const { getDeclarationForElement, styleAttributeChanged } = require("../helpers/style-rules");
const { nodeRoot } = require("../helpers/node");
const { updateFormAssociatedCustomElementsIn } = require("../helpers/form-associated-custom-elements");

// A border's used width: none where its style is none or hidden, and the
// keywords' widths as browsers draw them.
// https://drafts.csswg.org/css-backgrounds-3/#border-width
const BORDER_KEYWORDS = { thin: 1, medium: 3, thick: 5 };

function borderWidth(style, width) {
  if (!style || style === "none" || style === "hidden") {
    return 0;
  }

  if (!width) {
    return BORDER_KEYWORDS.medium;
  }

  const value = BORDER_KEYWORDS[width] ?? parseFloat(width);

  return Number.isFinite(value) && value > 0 ? value : 0;
}

function attachId(id, elm, doc) {
  if (id && elm && doc) {
    if (!doc._ids[id]) {
      doc._ids[id] = [];
    }
    doc._ids[id].push(elm);
  }
}

function detachId(id, elm, doc) {
  if (id && elm && doc) {
    if (doc._ids && doc._ids[id]) {
      const elms = doc._ids[id];
      for (let i = 0; i < elms.length; i++) {
        if (elms[i] === elm) {
          elms.splice(i, 1);
          --i;
        }
      }
      if (elms.length === 0) {
        delete doc._ids[id];
      }
    }
  }
}

class ElementImpl extends NodeImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    this._initSlotableMixin();

    this._namespaceURI = privateData.namespace;
    this._prefix = privateData.prefix;
    this._localName = privateData.localName;
    this._ceState = privateData.ceState;
    this._ceDefinition = privateData.ceDefinition;
    this._isValue = privateData.isValue;

    this._shadowRoot = null;
    this._ceReactionQueue = [];

    this.nodeType = NODE_TYPE.ELEMENT_NODE;
    this._scrollTop = 0;
    this._scrollLeft = 0;

    this._attributeList = [];
    // Used for caching.
    this._attributesByNameMap = new Map();
    this._attributes = NamedNodeMap.createImpl(this._globalObject, [], {
      element: this
    });

    this._cachedTagName = null;

    // add an internal index
    this._nodeIndex = this._ownerDocument._nodeCount || 0;
    this._ownerDocument._nodeCount = this._nodeIndex + 1;
  }

  _attach() {
    namedPropertiesWindow.nodeAttachedToDocument(this);
    namedPropertiesDocument.nodeAttachedToDocument(this);

    const id = this.getAttributeNS(null, "id");
    if (id) {
      attachId(id, this, this._ownerDocument);
    }

    // If the element is initially in an HTML document but is later
    // inserted in another type of document, the tagName should no
    // longer be uppercase. Therefore the cached tagName is reset.
    this._cachedTagName = null;
    super._attach();
  }

  _detach() {
    super._detach();

    namedPropertiesWindow.nodeDetachedFromDocument(this);
    namedPropertiesDocument.nodeDetachedFromDocument(this);

    const id = this.getAttributeNS(null, "id");
    if (id) {
      detachId(id, this, this._ownerDocument);
    }
  }

  // A move across the boundary between the document tree and a shadow tree changes which id and name maps hold
  // the element, without running the rest of what attaching and detaching do.
  _attachedChangedByMove() {
    const id = this.getAttributeNS(null, "id");
    if (this._attached) {
      namedPropertiesWindow.nodeAttachedToDocument(this);
      if (id) {
        attachId(id, this, this._ownerDocument);
      }
    } else {
      namedPropertiesWindow.nodeDetachedFromDocument(this);
      if (id) {
        detachId(id, this, this._ownerDocument);
      }
    }
  }

  _attrModified(name, value, oldValue) {
    this._modified();
    styleAttributeChanged(this, name, value, oldValue);
    namedPropertiesWindow.elementAttributeModified(this, name, value, oldValue);
    namedPropertiesDocument.elementAttributeModified(this, name, value, oldValue);

    if (name === "id" && this._attached) {
      const doc = this._ownerDocument;
      detachId(oldValue, this, doc);
      attachId(value, this, doc);
    }

    // A form-associated custom element that names its form by id follows the id.
    // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#reset-the-form-owner
    if (name === "id" && value !== oldValue && this._globalObject?._formAssociatedCustomElementsDefined) {
      updateFormAssociatedCustomElementsIn(nodeRoot(this));
    }

    // update classList
    if (name === "class" && this._classList !== undefined) {
      this._classList.attrModified();
    }

    this._attrModifiedSlotableMixin(name, value, oldValue);
  }

  get namespaceURI() {
    return this._namespaceURI;
  }
  get prefix() {
    return this._prefix;
  }
  get localName() {
    return this._localName;
  }
  get _qualifiedName() {
    return this._prefix !== null ? this._prefix + ":" + this._localName : this._localName;
  }
  get tagName() {
    // This getter can be a hotpath in getComputedStyle.
    // All these are invariants during the instance lifetime so we can safely cache the computed tagName.
    // We could create it during construction but since we already identified this as potentially slow we do it lazily.
    if (this._cachedTagName === null) {
      if (this.namespaceURI === HTML_NS && this._ownerDocument._parsingMode === "html") {
        this._cachedTagName = asciiUppercase(this._qualifiedName);
      } else {
        this._cachedTagName = this._qualifiedName;
      }
    }
    return this._cachedTagName;
  }

  get attributes() {
    return this._attributes;
  }

  // https://w3c.github.io/DOM-Parsing/#dom-element-outerhtml
  get outerHTML() {
    return fragmentSerialization(this, {
      outer: true,
      requireWellFormed: true,
      globalObject: this._globalObject
    });
  }
  set outerHTML(markup) {
    let parent = domSymbolTree.parent(this);
    const document = this._ownerDocument;

    if (!parent) {
      return;
    }

    if (parent.nodeType === NODE_TYPE.DOCUMENT_NODE) {
      throw DOMException.create(this._globalObject, [
        "Modifications are not allowed for this document",
        "NoModificationAllowedError"
      ]);
    }

    if (parent.nodeType === NODE_TYPE.DOCUMENT_FRAGMENT_NODE) {
      parent = document.createElementNS(HTML_NS, "body");
    }

    const fragment = parseFragment(markup, parent);

    const contextObjectParent = domSymbolTree.parent(this);
    contextObjectParent._replace(fragment, this);
  }

  get classList() {
    if (this._classList === undefined) {
      this._classList = DOMTokenList.createImpl(this._globalObject, [], {
        element: this,
        attributeLocalName: "class"
      });
    }
    return this._classList;
  }

  hasAttributes() {
    return attributes.hasAttributes(this);
  }

  getAttributeNames() {
    return attributes.attributeNames(this);
  }

  getAttribute(name) {
    const attr = attributes.getAttributeByName(this, name);
    if (!attr) {
      return null;
    }
    return attr._value;
  }

  getAttributeNS(namespace, localName) {
    const attr = attributes.getAttributeByNameNS(this, namespace, localName);
    if (!attr) {
      return null;
    }
    return attr._value;
  }

  setAttribute(name, value) {
    validateNames.attributeLocalName(this._globalObject, name);

    if (this._namespaceURI === HTML_NS && this._ownerDocument._parsingMode === "html") {
      name = asciiLowercase(name);
    }

    const attribute = attributes.getAttributeByName(this, name);

    if (attribute === null) {
      const newAttr = this._ownerDocument._createAttribute({
        localName: name,
        value
      });
      attributes.appendAttribute(this, newAttr);
      return;
    }

    attributes.changeAttribute(this, attribute, value);
  }

  setAttributeNS(namespace, name, value) {
    const extracted = validateNames.validateAndExtract(this._globalObject, namespace, name, "attribute");

    // Because of widespread use of this method internally, e.g. to manually implement attribute/content reflection, we
    // centralize the conversion to a string here, so that all call sites don't have to do it.
    value = `${value}`;

    attributes.setAttributeValue(this, extracted.localName, value, extracted.prefix, extracted.namespace);
  }

  removeAttribute(name) {
    attributes.removeAttributeByName(this, name);
  }

  removeAttributeNS(namespace, localName) {
    attributes.removeAttributeByNameNS(this, namespace, localName);
  }

  toggleAttribute(qualifiedName, force) {
    validateNames.attributeLocalName(this._globalObject, qualifiedName);

    if (this._namespaceURI === HTML_NS && this._ownerDocument._parsingMode === "html") {
      qualifiedName = asciiLowercase(qualifiedName);
    }

    const attribute = attributes.getAttributeByName(this, qualifiedName);

    if (attribute === null) {
      if (force === undefined || force === true) {
        const newAttr = this._ownerDocument._createAttribute({
          localName: qualifiedName,
          value: ""
        });
        attributes.appendAttribute(this, newAttr);
        return true;
      }
      return false;
    }

    if (force === undefined || force === false) {
      attributes.removeAttributeByName(this, qualifiedName);
      return false;
    }

    return true;
  }

  hasAttribute(name) {
    if (this._namespaceURI === HTML_NS && this._ownerDocument._parsingMode === "html") {
      name = asciiLowercase(name);
    }

    return attributes.hasAttributeByName(this, name);
  }

  hasAttributeNS(namespace, localName) {
    if (namespace === "") {
      namespace = null;
    }

    return attributes.hasAttributeByNameNS(this, namespace, localName);
  }

  getAttributeNode(name) {
    return attributes.getAttributeByName(this, name);
  }

  getAttributeNodeNS(namespace, localName) {
    return attributes.getAttributeByNameNS(this, namespace, localName);
  }

  setAttributeNode(attr) {
    // eslint-disable-next-line no-restricted-properties
    return attributes.setAttribute(this, attr);
  }

  setAttributeNodeNS(attr) {
    // eslint-disable-next-line no-restricted-properties
    return attributes.setAttribute(this, attr);
  }

  removeAttributeNode(attr) {
    // eslint-disable-next-line no-restricted-properties
    if (!attributes.hasAttribute(this, attr)) {
      throw DOMException.create(this._globalObject, [
        "Tried to remove an attribute that was not present",
        "NotFoundError"
      ]);
    }

    // eslint-disable-next-line no-restricted-properties
    attributes.removeAttribute(this, attr);

    return attr;
  }

  // https://drafts.csswg.org/cssom-view/#dom-element-scrolltop
  //
  // An offset stays within what the element can scroll, 0 to its scroll size
  // less its client size, as far as the layout says what those are; with no
  // layout it is kept as set, not below zero. The host is told of each change
  // (../helpers/element-scroll.js), to scroll what it draws to match: recorded
  // and not drawn, Rocket.Chat's message list was at the bottom for the page and
  // at the top on screen, and a wheel up had nowhere to go.
  //
  // What matters as much is that these exist. rfc-editor.org calls one during
  // render, and Nuxt answers a missing method with "Error 500: a.scrollTo is
  // not a function" in place of the page.
  get scrollTop() {
    return this._scrollTop;
  }

  set scrollTop(value) {
    this._scrollTo(null, Number(value));
  }

  get scrollLeft() {
    return this._scrollLeft;
  }

  set scrollLeft(value) {
    this._scrollTo(Number(value), null);
  }

  _scrollTo(x, y) {
    const client = Number.isFinite(x) || Number.isFinite(y) ? this._clientBox() : null;
    const extent = client ? this._scrollExtent() : null;
    const clamp = (value, size, clientSize) => {
      const floor = Math.max(0, value);

      return extent ? Math.min(floor, Math.max(0, size - clientSize)) : floor;
    };

    const left = Number.isFinite(x) ? clamp(x, extent?.width, client?.width) : this._scrollLeft;
    const top = Number.isFinite(y) ? clamp(y, extent?.height, client?.height) : this._scrollTop;

    if (left === this._scrollLeft && top === this._scrollTop) {
      return;
    }

    this._scrollLeft = left;
    this._scrollTop = top;
    elementScrolled(this);
  }

  /** The (x, y) and the options form, which both arrive here. */
  _scrollArguments(x, y) {
    if (x !== null && typeof x === "object") {
      return [Number(x.left), Number(x.top)];
    }

    return [Number(x), Number(y)];
  }

  scroll(x, y) {
    const [left, top] = this._scrollArguments(x, y);

    this._scrollTo(left, top);
  }

  scrollTo(x, y) {
    this.scroll(x, y);
  }

  scrollBy(x, y) {
    const [left, top] = this._scrollArguments(x, y);

    this._scrollTo(
      (Number.isFinite(left) ? left : 0) + this.scrollLeft,
      (Number.isFinite(top) ? top : 0) + this.scrollTop
    );
  }

  // Nothing to bring into view while the layout has no scrolling boxes, and a
  // page calls this for its effect rather than for an answer.
  scrollIntoView() {
  }

  // The border box, from whatever laid the document out. Zero throughout where
  // nothing did, which is this library on its own: see
  // ../helpers/layout-geometry.js.
  getBoundingClientRect() {
    const box = borderBoxOf(this) ?? { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      top: box.y,
      left: box.x,
      bottom: box.y + box.height,
      right: box.x + box.width
    };
  }

  // One rect per box the element generates. An inline element broken across
  // lines generates several and this reports the one; the border box is what
  // the layout source is asked for, and it does not describe the fragments.
  getClientRects() {
    return borderBoxOf(this) === null ? [] : [this.getBoundingClientRect()];
  }

  // https://drafts.csswg.org/cssom-view/#dom-element-scrollwidth
  //
  // The extent of what the element holds, from its border box's top left
  // corner: its own size, or further where a descendant's box reaches past
  // it. A box whose height or max-height cuts its content short reports the
  // content's height, which is what a collapsed panel is opened to. The root
  // is never less than the viewport. Zero where nothing laid the document out.
  _scrollExtent() {
    const own = borderBoxOf(this);

    if (own === null) {
      return { width: 0, height: 0 };
    }

    // Descendants are drawn moved by the element's own offset, which a scroll
    // size does not change with: it is put back.
    let right = own.x + own.width;
    let bottom = own.y + own.height;

    for (const node of domSymbolTree.treeIterator(this)) {
      if (node === this || node.nodeType !== NODE_TYPE.ELEMENT_NODE) {
        continue;
      }

      const box = borderBoxOf(node);

      if (box !== null && box.width > 0 && box.height > 0) {
        right = Math.max(right, box.x + box.width + this._scrollLeft);
        bottom = Math.max(bottom, box.y + box.height + this._scrollTop);
      }
    }

    const viewport = this._viewportClientSize();

    return {
      width: Math.max(Math.round(right - own.x), viewport?.width ?? 0),
      height: Math.max(Math.round(bottom - own.y), viewport?.height ?? 0)
    };
  }

  get scrollWidth() {
    return this._scrollExtent().width;
  }

  get scrollHeight() {
    return this._scrollExtent().height;
  }

  get clientTop() {
    return this._clientBox()?.top ?? 0;
  }

  get clientLeft() {
    return this._clientBox()?.left ?? 0;
  }

  // https://drafts.csswg.org/cssom-view/#dom-element-clientwidth
  //
  // The root element answers with the viewport, which is how a page reads the
  // viewport's size without a scrollbar: floating-ui clips every popup against
  // it, and at 0x0 it pinned them all to the top left corner. Every other
  // element needs its padding box, which the border box alone does not give.
  _viewportClientSize() {
    const window = this._ownerDocument._defaultView;

    if (!window || this !== this._ownerDocument.documentElement) {
      return null;
    }

    return { width: Number(window.innerWidth) || 0, height: Number(window.innerHeight) || 0 };
  }

  // The padding box, as the border box less the borders: binb draws no
  // scrollbars to take off as well. An inline box, or an element with none,
  // has no client box.
  _clientBox() {
    const viewport = this._viewportClientSize();

    if (viewport) {
      return { top: 0, left: 0, width: viewport.width, height: viewport.height };
    }

    const box = borderBoxOf(this);

    if (box === null) {
      return null;
    }

    const declaration = getDeclarationForElement(this);

    if ((declaration.getPropertyValue("display") || "inline") === "inline") {
      return null;
    }

    const border = side => borderWidth(
      declaration.getPropertyValue(`border-${side}-style`),
      declaration.getPropertyValue(`border-${side}-width`)
    );
    const top = border("top");
    const right = border("right");
    const bottom = border("bottom");
    const left = border("left");

    return {
      top: Math.round(top),
      left: Math.round(left),
      width: Math.max(0, Math.round(box.width - left - right)),
      height: Math.max(0, Math.round(box.height - top - bottom))
    };
  }

  get clientWidth() {
    return this._clientBox()?.width ?? 0;
  }

  get clientHeight() {
    return this._clientBox()?.height ?? 0;
  }

  // https://dom.spec.whatwg.org/#dom-element-attachshadow
  attachShadow(init) {
    this._attachShadowRoot(init);
    return this._shadowRoot;
  }

  // https://dom.spec.whatwg.org/#concept-attach-a-shadow-root
  // Shared by attachShadow(), the parser's declarative shadow roots and cloning, which is why the flags arrive
  // as one dictionary rather than from an IDL call.
  _attachShadowRoot({ mode, clonable = false, serializable = false, delegatesFocus = false, slotAssignment = "named" }) {
    const { _ownerDocument, _namespaceURI, _localName, _isValue } = this;

    if (this.namespaceURI !== HTML_NS) {
      throw DOMException.create(this._globalObject, [
        "This element does not support attachShadow. This element is not part of the HTML namespace.",
        "NotSupportedError"
      ]);
    }

    if (!isValidHostElementName(_localName) && !isValidCustomElementName(_localName)) {
      const message = "This element does not support attachShadow. This element is not a custom element nor " +
        "a standard element supporting a shadow root.";
      throw DOMException.create(this._globalObject, [message, "NotSupportedError"]);
    }

    if (isValidCustomElementName(_localName) || _isValue) {
      const definition = lookupCEDefinition(_ownerDocument, _namespaceURI, _localName, _isValue);

      if (definition && definition.disableShadow) {
        throw DOMException.create(this._globalObject, [
          "Shadow root cannot be create on a custom element with disabled shadow",
          "NotSupportedError"
        ]);
      }
    }

    if (this._shadowRoot !== null) {
      const current = this._shadowRoot;

      // A root the parser attached from markup is handed, emptied, to the first attachShadow() asking for its
      // mode, so a component that renders on the server and upgrades on the client gets the same root back.
      if (!current._declarative || current._mode !== mode) {
        throw DOMException.create(this._globalObject, [
          "Shadow root cannot be created on a host which already hosts a shadow tree.",
          "NotSupportedError"
        ]);
      }

      let child;
      while ((child = domSymbolTree.firstChild(current))) {
        current._remove(child);
      }
      current._declarative = false;
      return;
    }

    const shadow = ShadowRoot.createImpl(this._globalObject, [], {
      ownerDocument: this.ownerDocument,
      mode,
      delegatesFocus,
      slotAssignment,
      clonable,
      serializable,
      host: this
    });

    if (this._ceState === "precustomized" || this._ceState === "custom") {
      shadow._availableToElementInternals = true;
    }

    this._shadowRoot = shadow;
  }

  // https://dom.spec.whatwg.org/#dom-element-shadowroot
  get shadowRoot() {
    const shadow = this._shadowRoot;

    if (shadow === null || shadow.mode === "closed") {
      return null;
    }

    return shadow;
  }

  // https://dom.spec.whatwg.org/#insert-adjacent
  _insertAdjacent(element, where, node) {
    where = asciiLowercase(where);

    if (where === "beforebegin") {
      if (element.parentNode === null) {
        return null;
      }
      return element.parentNode._preInsert(node, element);
    }
    if (where === "afterbegin") {
      return element._preInsert(node, element.firstChild);
    }
    if (where === "beforeend") {
      return element._preInsert(node, null);
    }
    if (where === "afterend") {
      if (element.parentNode === null) {
        return null;
      }
      return element.parentNode._preInsert(node, element.nextSibling);
    }

    throw DOMException.create(this._globalObject, [
      'Must provide one of "beforebegin", "afterbegin", "beforeend", or "afterend".',
      "SyntaxError"
    ]);
  }

  insertAdjacentElement(where, element) {
    return this._insertAdjacent(this, where, element);
  }

  insertAdjacentText(where, data) {
    const text = Text.createImpl(this._globalObject, [], { data, ownerDocument: this._ownerDocument });

    this._insertAdjacent(this, where, text);
  }

  // https://w3c.github.io/DOM-Parsing/#dom-element-insertadjacenthtml
  insertAdjacentHTML(position, text) {
    position = asciiLowercase(position);

    let context;
    switch (position) {
      case "beforebegin":
      case "afterend": {
        context = this.parentNode;
        if (context === null || context.nodeType === NODE_TYPE.DOCUMENT_NODE) {
          throw DOMException.create(this._globalObject, [
            "Cannot insert HTML adjacent to parent-less nodes or children of document nodes.",
            "NoModificationAllowedError"
          ]);
        }
        break;
      }
      case "afterbegin":
      case "beforeend": {
        context = this;
        break;
      }
      default: {
        throw DOMException.create(this._globalObject, [
          'Must provide one of "beforebegin", "afterbegin", "beforeend", or "afterend".',
          "SyntaxError"
        ]);
      }
    }

    if (
      context.nodeType !== NODE_TYPE.ELEMENT_NODE ||
      (
        context._ownerDocument._parsingMode === "html" &&
        context._localName === "html" &&
        context._namespaceURI === HTML_NS
      )
    ) {
      context = context._ownerDocument.createElement("body");
    }

    const fragment = parseFragment(text, context);

    switch (position) {
      case "beforebegin": {
        this.parentNode._insert(fragment, this);
        break;
      }
      case "afterbegin": {
        this._insert(fragment, this.firstChild);
        break;
      }
      case "beforeend": {
        this._append(fragment);
        break;
      }
      case "afterend": {
        this.parentNode._insert(fragment, this.nextSibling);
        break;
      }
    }
  }

  closest(selectors) {
    const matcher = addNwsapi(this);
    return matcher.closest(selectors, idlUtils.wrapperForImpl(this));
  }

  // https://html.spec.whatwg.org/#reflecting-content-attributes-in-idl-attributes
  _reflectGetTheElement() {
    return this;
  }

  _reflectGetTheContentAttribute(reflectedContentAttributeName) {
    return this.getAttributeNS(null, reflectedContentAttributeName);
  }

  _reflectSetTheContentAttribute(reflectedContentAttributeName, value) {
    this.setAttributeNS(null, reflectedContentAttributeName, value);
  }

  _reflectDeleteTheContentAttribute(reflectedContentAttributeName) {
    this.removeAttributeNS(null, reflectedContentAttributeName);
  }
}

mixin(ElementImpl.prototype, NonDocumentTypeChildNode.prototype);
mixin(ElementImpl.prototype, ParentNodeImpl.prototype);
mixin(ElementImpl.prototype, ChildNodeImpl.prototype);
mixin(ElementImpl.prototype, SlotableMixinImpl.prototype);
mixin(ElementImpl.prototype, InnerHTMLImpl.prototype);

ElementImpl.prototype.getElementsByTagName = memoizeQuery(function (qualifiedName) {
  return listOfElementsWithQualifiedName(qualifiedName, this);
});

ElementImpl.prototype.getElementsByTagNameNS = memoizeQuery(function (namespace, localName) {
  return listOfElementsWithNamespaceAndLocalName(namespace, localName, this);
});

ElementImpl.prototype.getElementsByClassName = memoizeQuery(function (classNames) {
  return listOfElementsWithClassNames(classNames, this);
});

ElementImpl.prototype.matches = function (selectors) {
  const matcher = addNwsapi(this);

  return matcher.match(selectors, idlUtils.wrapperForImpl(this));
};

ElementImpl.prototype.webkitMatchesSelector = ElementImpl.prototype.matches;

module.exports = {
  implementation: ElementImpl
};
