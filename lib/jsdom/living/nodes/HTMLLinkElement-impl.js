"use strict";
const DOMTokenList = require("../generated/DOMTokenList");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const idlUtils = require("../generated/utils");
const { fetchStylesheet, removeStylesheet } = require("../helpers/stylesheets");
const { parseURLToResultingURLRecord } = require("../helpers/document-base-url");
const { updateExpectLink } = require("../helpers/render-blocking");
const { invalidateStyleCache } = require("../helpers/style-rules");
const whatwgURL = require("whatwg-url");
const { responseRefusal, corsCredentialsMode } = require("../helpers/subresource-checks");
const { extractMIMEType } = require("../helpers/content-type");

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
    maybePreload(this);
    updateExpectLink(this);
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

    if (name === "href" || name === "rel" || name === "as") {
      maybePreload(this);
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

// The `as` values a preload is fetched for, and the destination each fetches
// with. Any other value fetches nothing.
// https://html.spec.whatwg.org/multipage/links.html#link-type-preload
const PRELOAD_DESTINATIONS = new Map([
  ["script", "script"],
  ["style", "style"],
  ["fetch", ""],
  ["font", "font"],
  ["image", "image"],
  ["json", "json"]
]);

function relTokens(el) {
  return String(el.getAttributeNS(null, "rel") || "").toLowerCase().split(/[ \t\n\r\f]+/);
}

// https://html.spec.whatwg.org/multipage/links.html#link-type-preload
// https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload
//
// The resource is fetched and checked as its consumer would check it — its
// type under nosniff, and its integrity metadata — and the element fires load
// or error. The response is not kept here: the consumer asks for the same
// address again, which a resource loader that shares requests answers from
// this one.
function maybePreload(el) {
  if (!el.isConnected || !el._ownerDocument._defaultView) {
    return;
  }

  const rel = relTokens(el);
  const module = rel.includes("modulepreload");

  if (!module && !rel.includes("preload")) {
    return;
  }

  const href = el.getAttributeNS(null, "href");
  if (href === null || href === "") {
    return;
  }

  let destination;
  if (module) {
    destination = "script";
  } else {
    destination = PRELOAD_DESTINATIONS.get(String(el.getAttributeNS(null, "as") || "").toLowerCase());
    if (destination === undefined) {
      return;
    }
  }

  const url = parseURLToResultingURLRecord(href, el._ownerDocument);
  if (url === null) {
    return;
  }

  const urlString = whatwgURL.serializeURL(url);
  const key = `${module ? "module" : destination}|${urlString}`;
  if (el._preloadedKey === key) {
    return;
  }
  el._preloadedKey = key;

  const integrity = el.getAttributeNS(null, "integrity") || "";
  // A module preload is a CORS request whatever the attribute says.
  const credentialsMode = module ? corsCredentialsMode(el) || "same-origin" : corsCredentialsMode(el);
  let request = null;

  function onLoad(data) {
    const refusal = responseRefusal({
      element: el, request, url: urlString, data, destination, integrity, credentialsMode
    });
    if (refusal !== null) {
      throw new Error(refusal);
    }

    if (module) {
      const contentType = request && request.response ? extractMIMEType(request.response.headers) : null;
      if (contentType !== null && !contentType.isJavaScript()) {
        throw new Error(`Refused a module served as ${contentType.essence}`);
      }
    }
  }


  el._preloading = true;
  try {
    request = el._ownerDocument._resourceLoader.fetch(urlString, { element: el, onLoad });
  } finally {
    el._preloading = false;
  }
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
