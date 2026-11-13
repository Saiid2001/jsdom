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
const Headers = require("./Headers-impl").implementation;
const idlUtils = require("../generated/utils");
const Request = require("../generated/Request");

("use strict");

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

    this.origin = "client"; // Default origin, TODO: Implement proper origin handling
    this.client = null; // Client is not implemented, placeholder

    // "cors" unless stated: the default for a Request a page constructs.
    this.mode = init.mode || inherited.mode || "cors";

    // Guarded before it is filled, so that a page cannot state a header only
    // the browser may set -- Cookie, Origin, Referer, Sec-* -- and, in no-cors
    // mode, any header that is not CORS-safelisted.
    this.headers = new Headers(globalObject, []);
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
    this._bodyBuffer = init.body || inherited._bodyBuffer || null;
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
    
    const _signals = signal ? [signal] : [];
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
