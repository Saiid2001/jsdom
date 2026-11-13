"use strict";
const DOMTokenList = require("../generated/DOMTokenList");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const idlUtils = require("../generated/utils");
const { fetchStylesheet, removeStylesheet } = require("../helpers/stylesheets");
const { parseURLToResultingURLRecord } = require("../helpers/document-base-url");
const { updateExpectLink } = require("../helpers/render-blocking");
const { invalidateStyleCache } = require("../helpers/style-rules");
const { processPreloadLink, processModulePreloadLink } = require("../helpers/preload");
const whatwgURL = require("whatwg-url");

// Important reading: "appropriate times to obtain the resource" in
// https://html.spec.whatwg.org/multipage/semantics.html#link-type-stylesheet

class HTMLLinkElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    this.sheet = null;
  }

  get relList() {
    if (this._relList === undefined) {
      this._relList = DOMTokenList.createImpl(this._globalObject, [], {
        element: this,
        attributeLocalName: "rel",
        // prefetch, preconnect and dns-prefetch are hints this library takes no
        // action on, and are reported as unsupported for that reason.
        supportedTokens: new Set(["stylesheet", "preload", "modulepreload"])
      });
    }
    return this._relList;
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

  _attach() {
    super._attach();
    maybeFetchAndProcess(this);
    processPreloads(this, relTokens(this.getAttributeNS(null, "rel")));
    updateExpectLink(this);
  }

  // A link in a shadow tree is never attached, which is the document tree's
  // concern alone, and is processed once the tree it is in is connected.
  _postConnectionSteps() {
    if (!this._attached) {
      processPreloads(this, relTokens(this.getAttributeNS(null, "rel")));
    }
  }

  _detach() {
    super._detach();
    if (this.sheet) {
      removeStylesheet(this.sheet, this);
    }
    updateExpectLink(this);
  }

  _attrModified(name, value, oldValue) {
    super._attrModified(name, value, oldValue);

    if (name === "href") { // TODO crossorigin="" or type=""
      maybeFetchAndProcess(this);
    }

    if (name === "rel") {
      const before = relTokens(oldValue);
      const after = relTokens(value);

      // A link that becomes a style sheet link is fetched, and one that stops
      // being one loses its sheet: `<link rel=preload as=style
      // onload="this.rel='stylesheet'">` is how a page loads CSS without
      // blocking on it.
      // https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet
      if (!before.has("stylesheet") && after.has("stylesheet")) {
        maybeFetchAndProcess(this);
      } else if (before.has("stylesheet") && !after.has("stylesheet") && this.sheet) {
        removeStylesheet(this.sheet, this);
      }

      const added = new Set([...after].filter(token => !before.has(token)));
      processPreloads(this, added);
    }

    // A change to what is fetched fetches again. A change to type or media
    // only fetches what the old value kept from being fetched.
    if (name === "href" || name === "as" || name === "crossorigin") {
      processPreloads(this, relTokens(this.getAttributeNS(null, "rel")));
    } else if ((name === "type" || name === "media") && !this._preloadFetched) {
      processPreloads(this, relTokens(this.getAttributeNS(null, "rel")));
    }

    if (name === "media") {
      invalidateStyleCache(this);
    }

    if (name === "rel" && this._relList !== undefined) {
      this._relList.attrModified();
    }

    if (name === "blocking" && this._blockingList !== undefined) {
      this._blockingList.attrModified();
    }

    if (name === "rel" || name === "href" || name === "media" || name === "blocking") {
      updateExpectLink(this);
    }
  }

  get _accept() {
    return "text/css,*/*;q=0.1";
  }
}

module.exports = {
  implementation: HTMLLinkElementImpl
};

// A rel attribute's link types, which are compared ASCII case-insensitively.
function relTokens(value) {
  return new Set(String(value || "").toLowerCase().split(/[ \t\n\r\f]+/).filter(Boolean));
}

// Processes the preload link types among `tokens`.
function processPreloads(el, tokens) {
  if (tokens.has("preload")) {
    processPreloadLink(el);
  }
  if (tokens.has("modulepreload")) {
    processModulePreloadLink(el);
  }
}

// https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet
function maybeFetchAndProcess(el) {
  if (!isExternalResourceLink(el)) {
    return;
  }

  // Browsing-context connected
  if (!el.isConnected || !el._ownerDocument._defaultView) {
    return;
  }

  fetchAndProcess(el);
}

// https://html.spec.whatwg.org/multipage/semantics.html#default-fetch-and-process-the-linked-resource
// TODO: refactor into general link-fetching like the spec.
function fetchAndProcess(el) {
  const href = el.getAttributeNS(null, "href");

  if (href === null || href === "") {
    return;
  }

  const url = parseURLToResultingURLRecord(href, el._ownerDocument);
  if (url === null) {
    return;
  }

  // TODO handle crossorigin="", nonce, integrity="", referrerpolicy=""

  const serialized = whatwgURL.serializeURL(url);

  fetchStylesheet(el, serialized);
}

function isExternalResourceLink(el) {
  // for our purposes, only stylesheets can be external resource links
  const wrapper = idlUtils.wrapperForImpl(el);
  if (!/(?:[ \t\n\r\f]|^)stylesheet(?:[ \t\n\r\f]|$)/i.test(wrapper.rel)) {
    // rel is a space-separated list of tokens, and the original rel types
    // are case-insensitive.
    return false;
  }

  return el.hasAttributeNS(null, "href");
}
