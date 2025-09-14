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
const Response = require("../generated/Response");

("use strict");

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const ResponseType = {
  Basic: "basic",
  Cors: "cors",
  Default: "default",
  Error: "error",
  Opaque: "opaque",
  OpaqueRedirect: "opaqueredirect"
}

class ResponseImpl {
  constructor(globalObject, args, privateData) {
    this._globalObject = globalObject;
    this._type = ResponseType.Default;
    this._urlList = [];

    const [bodyWithType = {}, init = {}] = args;

    if (!init.status || init.status > 599 || init.status < 200) {
      throw new RangeError("Status must be in the range 200-599");
    }

    if (init.statusText && (init.statusText instanceof String && init.statusText.length > 0 && !/^[\t\n\f\r ]*$/.test(init.statusText))) {
      throw new TypeError("Status text must be a valid string");
    }

    this._status = init.status;
    this._statusText = init.statusText || "";

    // headers
    this.headers = new Headers(globalObject, [init.headers || {}]);

    // if status doesn't accept body but body is non-null, throw
    if (NULL_BODY_STATUSES.has(this._status) && !!bodyWithType?.buffer) {
      throw new TypeError("Response with status " + this._status + " cannot have a body");
    }

    // 4. If body is non-null, then set bodyWithType to the result of extracting body.
    this._bodyBuffer = bodyWithType?.buffer || null;
    if (this._bodyBuffer) this._computeBodyStream();
    if (
      this.headers.get("content-type") === null && 
      bodyWithType?.contentType
    ) {
      this.headers.set("content-type", bodyWithType.contentType);
    }
    else if (
      this.headers.get("content-type") === null &&
      this._typedStream?.contentType
    ) {
      this.headers.set("content-type", this._typedStream.contentType);
    }
  }

  static error(globalObject) {
    const response = Response.createImpl(globalObject, [null, { status: 200, statusText: "" }]);
    response._status = 0;
    response._setType(ResponseType.Error);
    return response;
  }

  static redirect(globalObject, url, status) {

    const _ownerDocument = idlUtils.implForWrapper(globalObject._document);
    const _baseURL = documentBaseURLSerialized(_ownerDocument);

    const fullUrl = new URL(url, _baseURL).href;

    if (!REDIRECT_STATUSES.has(status)) {
      throw new RangeError("Invalid status code for redirect");
    }

    return Response.createImpl(globalObject, [null, { status, headers: { "Location": fullUrl } }]);
  }

  static json(globalObject, data, init = {}) {
    const body = JSON.stringify(data);
    return Response.createImpl(globalObject, [{ buffer: body, contentType: "application/json" }, init]);
  }

  get type() {
    return this._type;
  }

  _setType(type) {
    this._type = type;
  }

  get url() {
    if (this._urlList.length > 0) {
      const _lastUrl = this._urlList[this._urlList.length - 1];

      // remove fragment
      const hashIndex = _lastUrl.indexOf('#');
      if (hashIndex !== -1) {
        return _lastUrl.slice(0, hashIndex);
      } else {
        return _lastUrl;
      }
    }

    return "";
  }

  get redirected() {
    return this._urlList.length > 1;
  }

  get status() {
    return this._status;
  }

  get ok() {
    return this._status >= 200 && this._status <= 299;
  }

  get statusText() {
    return this._statusText;
  }

  clone() {
    if (this._bodyUsed) {
      throw new TypeError("Body has already been used");
    }

    const _headers = new Headers(this._globalObject, [this.headers]);

    return ResponseImpl.createImpl(this._globalObject, [{ buffer: this._bodyBuffer, contentType: this.headers.get("content-type") }, { status: this._status, statusText: this._statusText, headers: _headers }]);
  }

}

mixin(ResponseImpl.prototype, BodyImpl.prototype);

module.exports = {
  implementation: ResponseImpl,
  NULL_BODY_STATUSES
};

