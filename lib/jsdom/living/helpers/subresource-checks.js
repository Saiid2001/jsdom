"use strict";
const { bytesMatchMetadata, hasIntegrityMetadata } = require("./integrity");
const { headerValue, blockedByNosniff, blockedByMIMEType } = require("./content-type");

// What an element checks of a response before it uses the bytes: whether the
// response is blocked by its type (nosniff, or a script served as an image),
// and whether it matches the element's integrity metadata. A response that
// fails is a network error to the element, which fires error and does not use
// it.

// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attribute
// null for no CORS request at all, else the request's credentials mode.
function corsCredentialsMode(element) {
  if (!element.hasAttributeNS(null, "crossorigin")) {
    return null;
  }

  const value = element.getAttributeNS(null, "crossorigin");
  return value.toLowerCase() === "use-credentials" ? "include" : "same-origin";
}

// https://fetch.spec.whatwg.org/#concept-cors-check
function corsCheck(headers, origin, credentialsMode) {
  const allowOrigin = headerValue(headers, "access-control-allow-origin");

  if (allowOrigin === null) {
    return false;
  }

  if (credentialsMode !== "include" && allowOrigin === "*") {
    return true;
  }

  if (allowOrigin !== origin) {
    return false;
  }

  if (credentialsMode !== "include") {
    return true;
  }

  return headerValue(headers, "access-control-allow-credentials") === "true";
}

function originOf(urlString) {
  try {
    return new URL(urlString).origin;
  } catch {
    return null;
  }
}

// Whether the response is one whose bytes the document may read: a basic
// response (same origin, or a data: or blob: URL), or a CORS response that
// passed the CORS check. Integrity is checked only against such a response
// (https://w3c.github.io/webappsec-subresource-integrity/#is-response-eligible).
function isEligibleForIntegrity({ element, responseURL, headers, documentOrigin, credentialsMode }) {
  const scheme = String(responseURL).split(":")[0].toLowerCase();

  if (scheme === "data" || scheme === "blob" || scheme === "about") {
    return true;
  }

  if (originOf(responseURL) === documentOrigin) {
    return true;
  }

  const mode = credentialsMode === undefined ? corsCredentialsMode(element) : credentialsMode;

  if (mode === null) {
    return false;
  }

  return corsCheck(headers, documentOrigin, mode);
}

/**
 * The reason a response must not be used, or null.
 *
 * `request` is what the resource loader answered with: its `response.headers`
 * are the response's headers, its `href` the address after redirects.
 * `destination` is the request's ("script", "style", ...); `integrity` the
 * metadata the element had when it was prepared.
 */
function responseRefusal({ element, request, url, data, destination, integrity, credentialsMode }) {
  const response = request && request.response;
  const headers = response ? response.headers : null;

  if (headers) {
    if (blockedByNosniff(headers, destination)) {
      return `Refused a ${destination} served with X-Content-Type-Options: nosniff and a mismatched type`;
    }

    if (blockedByMIMEType(headers, destination)) {
      return `Refused a ${destination} served with a type it cannot be`;
    }
  }

  if (hasIntegrityMetadata(integrity)) {
    const document = element._ownerDocument;
    const responseURL = (request && typeof request.href === "string" && request.href) || url;
    const documentOrigin = originOf(document.URL);

    if (!isEligibleForIntegrity({ element, responseURL, headers, documentOrigin, credentialsMode })) {
      return `Refused ${url}: integrity cannot be checked on a response the document may not read`;
    }

    if (!bytesMatchMetadata(data, integrity)) {
      return `Refused ${url}: its digest does not match the integrity metadata`;
    }
  }

  return null;
}

module.exports = {
  corsCredentialsMode,
  corsCheck,
  isEligibleForIntegrity,
  responseRefusal
};
