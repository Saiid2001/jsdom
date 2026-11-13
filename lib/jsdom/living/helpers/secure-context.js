"use strict";
const whatwgURL = require("whatwg-url");
const idlUtils = require("../generated/utils");

// Secure contexts (https://w3c.github.io/webappsec-secure-contexts/).
//
// webidl2js does not act on [SecureContext], so an interface or member carrying
// it is exposed everywhere unless the code that installs it asks here.

function isLoopbackHost(host) {
  if (typeof host === "number") {
    // An IPv4 address, as whatwg-url holds one: 127.0.0.0/8.
    return host >>> 24 === 127;
  }

  if (Array.isArray(host)) {
    // An IPv6 address as eight pieces: ::1.
    return host.slice(0, 7).every(piece => piece === 0) && host[7] === 1;
  }

  if (typeof host !== "string") {
    return false;
  }

  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost");
}

// https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy, for a
// URL record's origin.
function isPotentiallyTrustworthyOrigin(url) {
  if (url.scheme === "https" || url.scheme === "wss" || url.scheme === "file") {
    return true;
  }

  if (whatwgURL.serializeURLOrigin(url) === "null") {
    return false;
  }

  return isLoopbackHost(url.host);
}

// https://w3c.github.io/webappsec-secure-contexts/#is-url-trustworthy
exports.isPotentiallyTrustworthyURL = url => {
  if (url.scheme === "about") {
    const path = whatwgURL.serializePath(url);
    return path === "blank" || path === "srcdoc";
  }

  if (url.scheme === "data") {
    return true;
  }

  return isPotentiallyTrustworthyOrigin(url);
};

// Whether a document's environment is a secure context: its own URL, and that
// of every document it is nested in. A document with no window answers by its
// own URL alone.
exports.isSecureContext = documentImpl => {
  if (!exports.isPotentiallyTrustworthyURL(documentImpl._URL)) {
    return false;
  }

  const window = documentImpl._defaultView;
  const parent = window && window._parent;

  if (!parent || parent === window._globalProxy) {
    return true;
  }

  const parentDocument = parent._document && idlUtils.implForWrapper(parent._document);
  return parentDocument ? exports.isSecureContext(parentDocument) : true;
};
