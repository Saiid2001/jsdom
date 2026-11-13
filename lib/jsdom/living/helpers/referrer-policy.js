"use strict";
const idlUtils = require("../generated/utils");

// Referrer Policy (https://w3c.github.io/webappsec-referrer-policy/): the one
// place a request's Referer is decided. Every request a document starts takes
// its referrer from here -- element fetches, CSS fetches, navigations, XHR and
// fetch -- and so does the host application's resource loader, which follows
// redirects itself and determines the referrer again for each hop.

const POLICIES = new Set([
  "no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin",
  "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url"
]);

// https://html.spec.whatwg.org/multipage/semantics.html#meta-referrer
const LEGACY_META_VALUES = {
  "never": "no-referrer",
  "default": "strict-origin-when-cross-origin",
  "always": "unsafe-url",
  "origin-when-crossorigin": "origin-when-cross-origin"
};

// The longest referrer sent whole; a longer one is reduced to its origin.
const MAX_REFERRER_LENGTH = 4096;

const LOCAL_SCHEMES = new Set(["about:", "blob:", "data:"]);

exports.isPolicy = token => POLICIES.has(token);

// The last valid token of a Referrer-Policy header value, or "". A response
// carrying the header more than once is read as their values joined.
// https://w3c.github.io/webappsec-referrer-policy/#parse-referrer-policy-from-header
exports.parsePolicy = value => {
  let policy = "";
  const joined = Array.isArray(value) ? value.join(",") : String(value || "");

  for (const token of joined.split(",")) {
    const trimmed = token.trim().toLowerCase();

    if (POLICIES.has(trimmed)) {
      policy = trimmed;
    }
  }

  return policy;
};

// The policy a `referrerpolicy` content attribute is in: an enumerated
// attribute whose invalid and missing values are the empty-string state.
exports.parseAttribute = value => {
  const lowered = String(value ?? "").toLowerCase();

  return POLICIES.has(lowered) ? lowered : "";
};

// The policy a <meta name="referrer"> content value states, or "".
exports.parseMetaContent = value => {
  let lowered = String(value ?? "").toLowerCase();

  if (Object.hasOwn(LEGACY_META_VALUES, lowered)) {
    lowered = LEGACY_META_VALUES[lowered];
  }

  return POLICIES.has(lowered) ? lowered : "";
};

function documentImplOf(documentOrImpl) {
  return documentOrImpl ? idlUtils.implForWrapper(documentOrImpl) || documentOrImpl : null;
}

// The document's referrer policy: the one its Referrer-Policy header stated,
// replaced by each <meta name="referrer"> processed after it. "" is the
// default, strict-origin-when-cross-origin.
exports.documentPolicy = documentOrImpl => {
  const document = documentImplOf(documentOrImpl);

  return document && typeof document._referrerPolicy === "string" ? document._referrerPolicy : "";
};

// https://html.spec.whatwg.org/multipage/semantics.html#meta-referrer
// Run when a meta element is inserted into a document, or its name or content
// changes while it is in one. Removing the element leaves the policy it set.
exports.processMetaElement = metaImpl => {
  if (!metaImpl.isConnected || metaImpl.getRootNode({}) !== metaImpl._ownerDocument) {
    return;
  }

  const name = metaImpl.getAttributeNS(null, "name");

  if (name === null || name.toLowerCase() !== "referrer") {
    return;
  }

  const content = metaImpl.getAttributeNS(null, "content");

  if (content === null || content === "") {
    return;
  }

  const policy = exports.parseMetaContent(content);

  if (policy) {
    metaImpl._ownerDocument._referrerPolicy = policy;
  }
};

// The policy an element states for the request it makes: its referrerpolicy
// attribute, or no-referrer where a hyperlink or form says rel=noreferrer.
// "" where it states none, and the document's policy applies.
exports.elementPolicy = elementImpl => {
  if (!elementImpl || typeof elementImpl.getAttributeNS !== "function") {
    return "";
  }

  const local = elementImpl._localName;

  if (local === "a" || local === "area" || local === "form") {
    const rel = elementImpl.getAttributeNS(null, "rel");

    if (rel !== null && rel.toLowerCase().split(/[\t\n\f\r ]+/).includes("noreferrer")) {
      return "no-referrer";
    }
  }

  return exports.parseAttribute(elementImpl.getAttributeNS(null, "referrerpolicy"));
};

// The policy a request an element makes is under: the element's own, else
// its document's.
exports.requestPolicy = (elementImpl, documentOrImpl) => {
  return exports.elementPolicy(elementImpl) || exports.documentPolicy(documentOrImpl);
};

// https://w3c.github.io/webappsec-referrer-policy/#strip-url
function strip(url, originOnly) {
  if (LOCAL_SCHEMES.has(url.protocol)) {
    return null;
  }

  const stripped = new URL(url.href);
  stripped.username = "";
  stripped.password = "";
  stripped.hash = "";

  if (originOnly) {
    stripped.pathname = "";
    stripped.search = "";
  }

  return stripped;
}

// https://w3c.github.io/webappsec-secure-contexts/#is-url-trustworthy
function isPotentiallyTrustworthy(url) {
  if (url.href === "about:blank" || url.href === "about:srcdoc" || url.protocol === "data:") {
    return true;
  }

  if (url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "file:") {
    return true;
  }

  const host = url.hostname.toLowerCase();

  return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(host);
}
exports.isPotentiallyTrustworthy = value => {
  try {
    return isPotentiallyTrustworthy(new URL(String(value)));
  } catch {
    return false;
  }
};

// The Referer a request to `target` carries when its referrer is `source` and
// its policy `policy` ("" for the default), or null for none.
// https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
//
// `source` is the request's referrer: the client's URL for the first request,
// and for a redirect the referrer the previous request carried.
exports.determineReferrer = (source, target, policy) => {
  if (!source) {
    return null;
  }

  let sourceURL, current;

  try {
    sourceURL = new URL(String(source));
    current = new URL(String(target));
  } catch {
    return null;
  }

  let referrerURL = strip(sourceURL, false);
  const referrerOrigin = strip(sourceURL, true);

  if (referrerURL === null || referrerOrigin === null) {
    return null;
  }

  if (referrerURL.href.length > MAX_REFERRER_LENGTH) {
    referrerURL = referrerOrigin;
  }

  const full = referrerURL.href;
  const origin = referrerOrigin.href.length > MAX_REFERRER_LENGTH ? null : referrerOrigin.href;
  const sameOrigin = referrerURL.origin !== "null" && referrerURL.origin === current.origin;
  const downgrade = isPotentiallyTrustworthy(referrerURL) && !isPotentiallyTrustworthy(current);

  switch (policy || "strict-origin-when-cross-origin") {
    case "no-referrer":
      return null;
    case "no-referrer-when-downgrade":
      return downgrade ? null : full;
    case "same-origin":
      return sameOrigin ? full : null;
    case "origin":
      return origin;
    case "strict-origin":
      return downgrade ? null : origin;
    case "origin-when-cross-origin":
      return sameOrigin ? full : origin;
    case "unsafe-url":
      return full;
    default:
      return sameOrigin ? full : downgrade ? null : origin;
  }
};

// The referrer a document's own requests start from: its URL.
// https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer, step 3
exports.documentReferrerSource = documentOrImpl => {
  const document = documentImplOf(documentOrImpl);

  return document ? document.URL : null;
};
