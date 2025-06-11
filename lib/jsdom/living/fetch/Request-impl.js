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

("use strict");

class RequestImpl {
  constructor(globalObject, args, privateData) {
    this._globalObject = globalObject;
    this._ownerDocument = idlUtils.implForWrapper(globalObject._document);
    this._baseURL = documentBaseURLSerialized(this._ownerDocument);

    const [input, init = {}] = args;

    // Handle input as Request or string (URL)
    if (typeof input === "string" || input instanceof URL) {
      this.url = new URL(input.toString(), this._baseURL).href;
      this.method = (init.method || "GET").toUpperCase();
      this.headers = new Headers(globalObject, [init.headers || {}]);
    } else if (input && typeof input === "object" && input.url) {
      // input is a Request
      this.url = input.url;
      this.method = init.method ? init.method.toUpperCase() : input.method;
      this.headers = new Headers(globalObject, [init.headers || input.headers]);
    } else {
      throw new TypeError("Invalid input for Request");
    }

    this.origin = "client"; // Default origin, TODO: Implement proper origin handling
    this.client = null; // Client is not implemented, placeholder

    this.mode = init.mode || "no-cors";
    this.referrer =
      typeof init.referrer === "string" ? init.referrer : "client";
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

    this.credentials = init.credentials || "same-origin";
    this.cache = init.cache || "default";
    this.redirect = init.redirect || "follow";
    this.integrity = init.integrity || "";
    this.keepalive = !!init.keepalive;
    this.signal = init.signal || null;
    this.destination = "";
    this.referrerPolicy = init.referrerPolicy || "";

    // Initialize body-related properties
    this._bodyUsed = false;
    this._bodyBuffer = init.body || null;
    if (this._bodyBuffer) this._computeBodyStream();
    if (
      this.headers.get("content-type") === null &&
      this._typedStream.contentType
    ) {
      this.headers.set("content-type", this._typedStream.contentType);
    }
  }

  clone() {
    if (this._bodyUsed) {
      throw new TypeError("Body has already been used");
    }
    return new this.constructor(this._globalObject, [this, {}]);
  }

  get isReloadNavigation() {}
}

mixin(RequestImpl.prototype, BodyImpl.prototype);

module.exports = {
  implementation: RequestImpl,
};
