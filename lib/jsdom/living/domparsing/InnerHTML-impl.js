"use strict";

const { parseFragment } = require("../../browser/parser");
const htmlParser = require("../../browser/parser/html");
const { HTML_NS } = require("../helpers/namespaces.js");
const { isShadowRoot } = require("../helpers/shadow-dom.js");
const NODE_TYPE = require("../node-type.js");
const { fragmentSerialization, htmlFragmentSerialization } = require("./serialization.js");

// https://w3c.github.io/DOM-Parsing/#the-innerhtml-mixin
exports.implementation = class InnerHTMLImpl {
  // https://w3c.github.io/DOM-Parsing/#dom-innerhtml-innerhtml
  get innerHTML() {
    return fragmentSerialization(this, {
      outer: false,
      requireWellFormed: true,
      globalObject: this._globalObject
    });
  }
  set innerHTML(markup) {
    const contextElement = isShadowRoot(this) ? this.host : this;
    const fragment = parseFragment(markup, contextElement);

    let contextObject = this;
    if (this.nodeType === NODE_TYPE.ELEMENT_NODE && this.localName === "template" && this.namespaceURI === HTML_NS) {
      contextObject = this._templateContents;
    }

    contextObject._replaceAll(fragment);
  }

  // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-element-sethtmlunsafe
  // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-shadowroot-sethtmlunsafe
  // The HTML fragment parser whatever the document's type, and with declarative shadow roots allowed.
  setHTMLUnsafe(html) {
    const contextElement = isShadowRoot(this) ? this.host : this;
    const fragment = htmlParser.parseFragment(html, contextElement, { allowDeclarativeShadowRoots: true });

    let target = this;
    if (this.nodeType === NODE_TYPE.ELEMENT_NODE && this.localName === "template" && this.namespaceURI === HTML_NS) {
      target = this._templateContents;
    }

    target._replaceAll(fragment);
  }

  // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-element-gethtml
  // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-shadowroot-gethtml
  getHTML(options) {
    return htmlFragmentSerialization(this, {
      serializableShadowRoots: options.serializableShadowRoots,
      shadowRoots: options.shadowRoots
    });
  }
};
