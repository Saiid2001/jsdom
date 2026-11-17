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
const Response = require("../generated/Response");

("use strict");

const XMLHttpRequestExtractBody = require("../xhr/XMLHttpRequest-impl").extractBody;
const urlencoded = require("whatwg-url/lib/urlencoded");
const { extractBody: extractBodyInit } = require("../helpers/extract-body");

// The body a Response is constructed with, as {buffer, contentType}. Internal
// callers pass that shape already; a page passes BodyInit, which was read as
// if it were that shape, so `new Response("text")` had no body at all.
// https://fetch.spec.whatwg.org/#concept-bodyinit-extract
function bodyOf(body) {
  if (body === null || body === undefined) {
    return { buffer: null, contentType: null };
  }

  if (typeof body === "object" && Object.getPrototypeOf(body) === Object.prototype && "buffer" in body) {
    return typeof body.buffer === "string" ? { ...body, buffer: Buffer.from(body.buffer, "utf-8") } : body;
  }

  if (typeof body === "object" || typeof body === "function") {
    const tag = Object.prototype.toString.call(body);

    if (tag === "[object URLSearchParams]" || Array.isArray(body._list)) {
      return {
        buffer: Buffer.from(Array.isArray(body._list) ? urlencoded.serializeUrlencoded(body._list) : String(body), "utf-8"),
        contentType: "application/x-www-form-urlencoded;charset=UTF-8"
      };
    }

    // A ReadableStream is read when the body is consumed.
    if (typeof body.getReader === "function") {
      return { buffer: null, contentType: null, stream: body };
    }

    // Blob, FormData (as multipart bytes), BufferSource: extracted as a
    // Request's body is.
    const extracted = extractBodyInit(body);
    if (extracted) {
      return extracted;
    }

    // Platform objects arrive as their wrappers now that the constructor
    // takes any: Blob and FormData are extracted from their impls.
    body = idlUtils.implForWrapper(body) || body;
  }

  if (typeof body !== "object" || body === null) {
    body = String(body);
  }

  const { buffer = null, contentType = null } = XMLHttpRequestExtractBody(body);

  return { buffer, contentType };
}

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

    const [body = null, init = {}] = args;
    const bodyWithType = bodyOf(body);

    if (!init.status || init.status > 599 || init.status < 200) {
      throw new RangeError("Status must be in the range 200-599");
    }

    if (init.statusText && (init.statusText instanceof String && init.statusText.length > 0 && !/^[\t\n\f\r ]*$/.test(init.statusText))) {
      throw new TypeError("Status text must be a valid string");
    }

    this._status = init.status;
    this._statusText = init.statusText || "";

    // headers
    // Made through the interface, so that the page's response.headers is a Headers
    // with all of its methods -- forEach, entries -- rather than this implementation.
    this.headers = HeadersInterface.createImpl(globalObject, [init.headers || {}]);

    // if status doesn't accept body but body is non-null, throw
    if (NULL_BODY_STATUSES.has(this._status) && !!bodyWithType?.buffer) {
      throw new TypeError("Response with status " + this._status + " cannot have a body");
    }

    // 4. If body is non-null, then set bodyWithType to the result of extracting body.
    this._bodyBuffer = bodyWithType?.buffer || null;
    // A ReadableStream body, read whole when the body is consumed.
    this._bodySource = bodyWithType?.stream || null;
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

    const _headers = HeadersInterface.createImpl(this._globalObject, [this.headers]);

    const clone = Response.createImpl(this._globalObject, [{ buffer: this._bodyBuffer, contentType: this.headers.get("content-type") }, { status: 200, statusText: this._statusText, headers: _headers }]);

    // Set after construction: a filtered response's status (0, for an opaque
    // one) is not one the constructor accepts.
    clone._status = this._status;
    clone._setType(this._type);
    clone._urlList = this._urlList.slice();

    return clone;
  }

}

mixin(ResponseImpl.prototype, BodyImpl.prototype);

module.exports = {
  implementation: ResponseImpl,
  NULL_BODY_STATUSES
};

