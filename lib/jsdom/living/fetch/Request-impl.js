const { URL } = require("whatwg-url");
const {
  implementation: BodyImpl,
  extractBody,
  consumeBody,
} = require("./Body-impl");
const { mixin } = require("../../utils");
const {
  documentBaseURLSerialized,
  documentBaseURL,
} = require("../helpers/document-base-url");
const HeadersInterface = require("../generated/Headers");
const idlUtils = require("../generated/utils");
const Request = require("../generated/Request");

("use strict");

const blobURLStore = require("../file-api/blob-url-store");
const { extractBody: extractBodyInit } = require("../helpers/extract-body");

class RequestImpl {
  constructor(globalObject, args, privateData) {
    this._globalObject = globalObject;
    this._ownerDocument = idlUtils.implForWrapper(globalObject._document);
    this._baseURL = documentBaseURLSerialized(this._ownerDocument);

    const [input, init = {}] = args;

    let signal = null;
    // A Request made from another carries that one's settings, each replaced
    // by what init states (https://fetch.spec.whatwg.org/#dom-request).
    let inherited = {};

    // Handle input as Request or string (URL)
    if (typeof input === "string" || input instanceof URL) {
      this.url = new URL(input.toString(), this._baseURL).href;
      this.method = (init.method || "GET").toUpperCase();
    } else if (input && typeof input === "object" && input.url) {
      // input is a Request
      this.url = input.url;
      this.method = init.method ? init.method.toUpperCase() : input.method;
      inherited = input;
      signal = input.signal;
    } else {
      throw new TypeError("Invalid input for Request");
    }

    // https://fetch.spec.whatwg.org/#concept-request-url, a blob URL's entry
    // is resolved when the request is made, so revoking the URL afterwards
    // does not take the bytes from a request that already names them.
    if (typeof input === "object" && input !== null && !(input instanceof URL) && input.url) {
      const inputImpl = idlUtils.implForWrapper(input) || input;
      this._blobURLEntry = inputImpl._blobURLEntry ?? null;
    } else {
      this._blobURLEntry = this.url.startsWith("blob:") ? blobURLStore.resolveBlobURL(this.url) : null;
    }

    this.origin = "client"; // Default origin, TODO: Implement proper origin handling
    this.client = null; // Client is not implemented, placeholder

    // "cors" unless stated: the default for a Request a page constructs.
    this.mode = init.mode || inherited.mode || "cors";

    // Guarded before it is filled, so that a page cannot state a header only
    // the browser may set -- Cookie, Origin, Referer, Sec-* -- and, in no-cors
    // mode, any header that is not CORS-safelisted.
    // Made through the interface, so that the page's request.headers is a Headers
    // with all of its methods rather than this implementation object.
    this.headers = HeadersInterface.createImpl(globalObject, []);
    this.headers.guard = this.mode === "no-cors" ? "request-no-cors" : "request";
    this.headers._fill(init.headers || inherited.headers || {});

    this.referrer =
      typeof init.referrer === "string" ? init.referrer : (inherited.referrer || "client");
    if (init.referrer) {
      if (this.referrer.length === 0) this.referrer = "no-referrer";
      else {
        const parsedReferrer = new URL(this.referrer, this._baseURL);

        if (
          parsedReferrer.protocol === "about:" &&
          parsedReferrer.pathname === "client"
        ) {
          this.referrer = "client";
        }

        // TODO: parsedReferrer’s origin is not same origin with origin
      }
    }

    if (this.mode === "navigate") {
      throw new TypeError("Navigate mode is not supported in fetch API");
    }

    this.credentials = init.credentials || inherited.credentials || "same-origin";
    this.cache = init.cache || inherited.cache || "default";
    this.redirect = init.redirect || inherited.redirect || "follow";
    this.integrity = init.integrity || inherited.integrity || "";
    this.keepalive = init.keepalive !== undefined ? !!init.keepalive : !!inherited.keepalive;
    signal = init.signal || signal;
    this.destination = "";
    this.referrerPolicy = init.referrerPolicy || inherited.referrerPolicy || "";

    // Initialize body-related properties
    this._bodyUsed = false;
    // The body's bytes and the type its kind gives it; a stream is left as it
    // is. With no body in init, a Request made from another keeps that one's.
    const extracted = init.body === undefined || init.body === null ? null : extractBodyInit(init.body);
    const inheritedImpl = idlUtils.implForWrapper(inherited) || inherited;
    this._bodyBuffer = extracted ? extracted.buffer : (init.body || inheritedImpl._bodyBuffer || null);
    if (extracted && extracted.contentType !== null && this.headers.get("content-type") === null) {
      this.headers.set("content-type", extracted.contentType);
    }
    if (this._bodyBuffer) this._computeBodyStream();
    if (
      this.headers.get("content-type") === null &&
      this._typedStream?.contentType
    ) {
      this.headers.set("content-type", this._typedStream.contentType);
    }

    // create URL List
    this._urlList = [this.url];

    // Set flags
    this.flags = {
      done: false,
    }

    // set this signal
    const AbortSignal = globalObject.AbortSignal;
    
    // AbortSignal.any is the interface's, and takes wrappers. RequestInit's
    // converter hands the signal over as an impl, while a Request passed as the
    // input carries a wrapper; given the impl, every fetch made with a signal
    // threw before it was sent.
    const _signals = signal ? [idlUtils.tryWrapperForImpl(signal)] : [];
    this.signal = AbortSignal.any(_signals);

  }

  clone() {
    if (this._bodyUsed) {
      throw new TypeError("Body has already been used");
    }
    return Request.createImpl(this._globalObject, [this, {}]);
  }

  get isReloadNavigation() {}
}

mixin(RequestImpl.prototype, BodyImpl.prototype);

module.exports = {
  implementation: RequestImpl,
};
