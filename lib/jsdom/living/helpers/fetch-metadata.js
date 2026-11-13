"use strict";
const { getPublicSuffix } = require("tough-cookie");

// Fetch metadata request headers (https://w3c.github.io/webappsec-fetch-metadata/):
// what a browser tells a site about how and from where a request was made.
//
// Sent only to https and wss. The specification sends them to any potentially
// trustworthy URL, which includes http://localhost; the http a host
// application carries beyond loopback is an allow-listed, untrustworthy origin
// and receives none, and loopback http is treated the same way rather than as
// a second rule.

function site(url) {
  let registrable;

  try {
    registrable = getPublicSuffix(url.hostname, { allowSpecialUseDomain: true });
  } catch {
    registrable = undefined;
  }

  return `${url.protocol}//${registrable || url.hostname}`;
}

// https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-site-header
// initiatorOrigin null is a request a person started: "none".
exports.fetchSite = (initiatorOrigin, target) => {
  if (initiatorOrigin === null || initiatorOrigin === undefined) {
    return "none";
  }

  let destination, initiator;

  try {
    destination = new URL(String(target));
    initiator = new URL(String(initiatorOrigin));
  } catch {
    return "cross-site";
  }

  // An opaque origin is same-site with nothing.
  if (initiator.origin === "null") {
    return "cross-site";
  }

  if (initiator.origin === destination.origin) {
    return "same-origin";
  }

  return site(initiator) === site(destination) ? "same-site" : "cross-site";
};

exports.sendsFetchMetadata = target => {
  try {
    const { protocol } = new URL(String(target));

    return protocol === "https:" || protocol === "wss:";
  } catch {
    return false;
  }
};

/**
 * The headers, lowercased, or none for a destination that is not sent them.
 *
 * mode: the request's mode ("cors", "no-cors", "same-origin", "navigate", "websocket").
 * dest: the request's destination, "" being "empty".
 * user: a navigation a person started (Sec-Fetch-User).
 */
exports.fetchMetadataHeaders = ({ url, initiatorOrigin, mode, dest, user = false }) => {
  if (!exports.sendsFetchMetadata(url)) {
    return {};
  }

  const headers = {
    "sec-fetch-site": exports.fetchSite(initiatorOrigin, url),
    "sec-fetch-mode": mode,
    "sec-fetch-dest": dest || "empty"
  };

  if (mode === "navigate" && user) {
    headers["sec-fetch-user"] = "?1";
  }

  return headers;
};

// The destination of what an element fetches
// (https://html.spec.whatwg.org/#concept-request-destination, per element).
const DESTINATIONS = {
  script: "script",
  img: "image",
  image: "image",
  input: "image",
  picture: "image",
  source: "image",
  video: "video",
  audio: "audio",
  track: "track",
  iframe: "iframe",
  frame: "frame",
  object: "object",
  embed: "embed",
  feimage: "image"
};

function linkDestination(element) {
  const rel = String(element.getAttribute("rel") || "").toLowerCase().split(/\s+/);

  if (rel.includes("modulepreload")) {
    return "script";
  }

  if (rel.includes("preload")) {
    const as = String(element.getAttribute("as") || "").toLowerCase();
    return as === "fetch" ? "" : as;
  }

  if (rel.includes("stylesheet")) {
    return "style";
  }

  if (rel.includes("icon")) {
    return "image";
  }

  if (rel.includes("manifest")) {
    return "manifest";
  }

  return "";
}

/**
 * The mode and destination of a request an element makes, or a document
 * navigation's where there is no element.
 */
exports.requestOf = element => {
  if (!element) {
    return { mode: "navigate", dest: "document" };
  }

  const name = String(element.localName || "").toLowerCase();
  const dest = name === "link" ? linkDestination(element) : (DESTINATIONS[name] || "");

  if (dest === "iframe" || dest === "frame") {
    return { mode: "navigate", dest };
  }

  // A module script, and any element whose crossorigin attribute is set, is
  // fetched in "cors" mode; the rest in "no-cors".
  const cors = (name === "script" && String(element.getAttribute("type") || "").toLowerCase() === "module") ||
    (name === "link" && /(?:^|\s)modulepreload(?:\s|$)/i.test(String(element.getAttribute("rel") || ""))) ||
    (typeof element.hasAttribute === "function" && element.hasAttribute("crossorigin"));

  return { mode: cors ? "cors" : "no-cors", dest };
};
