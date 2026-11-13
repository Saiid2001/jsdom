"use strict";
const MIMEType = require("whatwg-mimetype");
const whatwgURL = require("whatwg-url");
const idlUtils = require("../generated/utils");
const { fireAnEvent } = require("./events");
const { matchesMediaList, viewportForWindow } = require("./media-queries");
const { parseURLToResultingURLRecord } = require("./document-base-url");

// <link rel=preload>: a document's map of preloaded resources, and the requests
// that consume an entry of it instead of fetching again.
// https://html.spec.whatwg.org/multipage/links.html#link-type-preload
// https://html.spec.whatwg.org/multipage/links.html#map-of-preloaded-resources
//
// An entry holds the request the window's resource loader made, which is what
// every element of this library reads a subresource off (`response`, `href`,
// the body it resolves with), so an element consuming one proceeds exactly as if
// it had made the request itself. fetch() and XMLHttpRequest read a response
// through xhr-utils' client instead, and are answered from the same entry there.

// The `as` values a preload is made for: the destinations something in this
// library later requests. A media element, a document or a worker never asks
// for what was preloaded for it, so preloading one is a fetch nothing consumes.
const PRELOAD_DESTINATIONS = new Set(["fetch", "font", "image", "script", "style", "track"]);

const IMAGE_TYPES = new Set([
  "image/apng", "image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/svg+xml",
  "image/vnd.microsoft.icon", "image/webp", "image/x-icon"
]);

const FONT_TYPES = new Set([
  "font/collection", "font/otf", "font/sfnt", "font/ttf", "font/woff", "font/woff2",
  "application/font-sfnt", "application/font-woff", "application/vnd.ms-fontobject", "application/x-font-ttf",
  "application/x-font-otf", "application/x-font-woff"
]);

// https://fetch.spec.whatwg.org/#concept-potential-destination-translate
function translateDestination(as) {
  return as === "fetch" ? "" : as;
}

// Whether `type` names a resource the destination can use; an unparsable type
// can be used by none of them.
// https://html.spec.whatwg.org/multipage/links.html#link-type-preload (step "If el has a type attribute")
function typeSupported(destination, type) {
  const mimeType = MIMEType.parse(type);
  if (!mimeType) {
    return false;
  }
  const { essence } = mimeType;
  switch (destination) {
    case "image":
      return IMAGE_TYPES.has(essence);
    case "font":
      return FONT_TYPES.has(essence);
    case "script":
      // Required lazily: module-scripts requires this file.
      return require("./module-scripts").javaScriptMIMETypeEssences.has(essence);
    case "style":
      return essence === "text/css";
    case "track":
      return essence === "text/vtt";
    default:
      return true;
  }
}

/**
 * The mode and credentials mode a CORS settings attribute asks for.
 * https://html.spec.whatwg.org/multipage/urls-and-fetching.html#create-a-potential-cors-request
 */
function corsSettingsOf(element) {
  const value = element.getAttributeNS(null, "crossorigin");
  if (value === null) {
    return { mode: "no-cors", credentials: "include" };
  }
  return { mode: "cors", credentials: value.toLowerCase() === "use-credentials" ? "include" : "same-origin" };
}

exports.corsSettingsOf = corsSettingsOf;

// https://fetch.spec.whatwg.org/#concept-request-preload-key
function preloadKey(url, { destination, mode, credentials }) {
  return JSON.stringify([url, destination, mode, credentials]);
}

function mapOf(document) {
  if (!document._preloadedResources) {
    document._preloadedResources = new Map();
  }
  return document._preloadedResources;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function headerOf(request, name) {
  const headers = request.response && request.response.headers;
  if (!headers) {
    return undefined;
  }
  const value = headers[name] !== undefined ? headers[name] : headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

// https://fetch.spec.whatwg.org/#concept-cors-check
function corsCheck(request, documentOrigin, credentials) {
  const allowOrigin = headerOf(request, "access-control-allow-origin");
  if (allowOrigin === undefined || allowOrigin === null) {
    return false;
  }
  const value = String(allowOrigin).trim();
  if (credentials !== "include" && value === "*") {
    return true;
  }
  if (value !== documentOrigin) {
    return false;
  }
  if (credentials !== "include") {
    return true;
  }
  return String(headerOf(request, "access-control-allow-credentials") || "").trim() === "true";
}

/**
 * A request for one use: settles as the loader's request did, or rejects where
 * the preload ended as a network error. Every property an element reads off a
 * request is read through, live, as the request has it when it is read.
 */
function handleFor(entry) {
  const handle = entry.outcome.then(({ body }) => body);
  handle.catch(() => {});

  Object.defineProperties(handle, {
    abort: { value: () => {} },
    href: { get: () => entry.request.href },
    response: { get: () => entry.request.response },
    statusCode: { get: () => entry.request.statusCode },
    getHeader: {
      value: name => (typeof entry.request.getHeader === "function" ? entry.request.getHeader(name) : null)
    }
  });

  return handle;
}

/**
 * Starts a preload fetch and files it in the document's map, or answers with
 * the entry already filed under the same key.
 */
function preload(document, url, options) {
  const map = mapOf(document);
  const key = preloadKey(url, options);
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const window = document._defaultView;
  const loader = window && window._resourceLoader;
  const documentOrigin = originOf(document.URL);
  const crossOrigin = originOf(url) !== documentOrigin;
  const { destination, mode, credentials, element } = options;

  const additionalHeaders = {};
  if (mode === "cors" && crossOrigin && documentOrigin && documentOrigin !== "null") {
    additionalHeaders.Origin = documentOrigin;
  }

  const sendsCookies = credentials === "include" || (credentials === "same-origin" && !crossOrigin);

  let request = null;
  try {
    request = loader ?
      loader.fetch(url, {
        cookieJar: sendsCookies ? document._cookieJar : null,
        element: idlUtils.wrapperForImpl(element),
        referrer: document.URL,
        accept: destination === "style" ? "text/css,*/*;q=0.1" : undefined,
        mode,
        destination,
        additionalHeaders
      }) :
      null;
  } catch {
    request = null;
  }

  if (!request) {
    request = Promise.reject(new Error(`Could not preload ${url}`));
    request.abort = () => {};
  }

  const entry = { key, url, request, outcome: null };

  // A response that is not ok is still a response; a network error, a refused
  // request, and a cors response the site does not share are not.
  entry.outcome = Promise.resolve(request).then(body => {
    if (mode === "cors" && crossOrigin && !corsCheck(request, documentOrigin, credentials)) {
      throw new TypeError(`${url} is not shared with ${documentOrigin}`);
    }
    return { body };
  });
  entry.outcome.catch(() => {});

  if (document._requestManager && typeof request.abort === "function") {
    document._requestManager.add(request);
    const forget = () => document._requestManager.remove(request);
    entry.outcome.then(forget, forget);
  }

  map.set(key, entry);
  return entry;
}

// Whether the element's media attribute, if it has one, matches the environment.
function mediaMatches(element) {
  const media = element.getAttributeNS(null, "media");
  return media === null || media.trim() === "" ||
    matchesMediaList([media], viewportForWindow(element._ownerDocument._defaultView));
}

/**
 * The preloaded request for a request about to be made, taken out of the map so
 * that it is used once, or null when there is none.
 * https://html.spec.whatwg.org/multipage/links.html#consume-a-preloaded-resource
 */
exports.consumePreloadedResource = (document, url, options) => {
  const entry = takeEntry(document, url, options);
  return entry ? handleFor(entry) : null;
};

function takeEntry(document, url, options) {
  const map = document && document._preloadedResources;
  if (!map || map.size === 0) {
    return null;
  }
  const key = preloadKey(url, options);
  const entry = map.get(key);
  if (!entry) {
    return null;
  }
  map.delete(key);
  return entry;
}

/**
 * The preloaded response for fetch() or XMLHttpRequest, as what it resolves
 * with: `{ status, statusMessage, headers, url, body }`, rejecting where the
 * preload ended as a network error. null when nothing was preloaded for it.
 */
exports.consumePreloadedResponse = (document, url, options) => {
  const entry = takeEntry(document, url, options);
  if (!entry) {
    return null;
  }
  return entry.outcome.then(({ body }) => {
    const response = entry.request.response || {};
    return {
      status: typeof response.statusCode === "number" ? response.statusCode : 200,
      statusMessage: response.statusMessage || "",
      headers: response.headers || {},
      url: entry.request.href || url,
      body: Buffer.isBuffer(body) ? body : Buffer.from(body || [])
    };
  });
};

/**
 * The request a consumer makes for an element, by the destination it fetches
 * and its CORS settings attribute.
 */
exports.requestOptionsOf = (element, destination) => {
  return { destination, ...corsSettingsOf(element) };
};

/**
 * Processes a <link rel=preload>: when it is browsing-context connected, its
 * `as` names a destination preloaded for, and its type and media apply, fetches
 * what it names and fires load at it once there is a response, or error at a
 * network error.
 * https://html.spec.whatwg.org/multipage/links.html#link-type-preload
 */
exports.processPreloadLink = element => {
  const document = element._ownerDocument;
  element._preloadFetched = false;
  if (!element.isConnected || !document._defaultView) {
    return;
  }

  const href = element.getAttributeNS(null, "href");
  if (href === null || href === "") {
    return;
  }

  const as = (element.getAttributeNS(null, "as") || "").toLowerCase();
  if (!PRELOAD_DESTINATIONS.has(as)) {
    return;
  }
  const destination = translateDestination(as);

  const type = element.getAttributeNS(null, "type");
  if (type !== null && !typeSupported(as, type)) {
    return;
  }

  if (!mediaMatches(element)) {
    return;
  }

  const url = parseURLToResultingURLRecord(href, document);
  if (url === null) {
    return;
  }

  const options = { destination, ...corsSettingsOf(element), element };
  const entry = preload(document, whatwgURL.serializeURL(url), options);
  element._preloadFetched = true;

  const generation = (element._preloadGeneration || 0) + 1;
  element._preloadGeneration = generation;

  entry.outcome.then(() => "load", () => "error").then(type => {
    // A later processing of the element fires its own event in place of this one.
    if (element._preloadGeneration === generation) {
      fireAnEvent(type, element);
    }
  });
};

// The `as` values modulepreload accepts, by the module type each is fetched as;
// a value that names no destination is "script".
// https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload
const SCRIPT_LIKE = new Set(["audioworklet", "paintworklet", "script", "serviceworker", "sharedworker", "worker"]);
const DESTINATIONS = new Set([
  "fetch", "audio", "audioworklet", "document", "embed", "font", "frame", "iframe", "image", "json", "manifest",
  "object", "paintworklet", "report", "script", "serviceworker", "sharedworker", "style", "text", "track", "video",
  "webidentity", "worker", "xslt"
]);

function moduleTypeFor(as) {
  if (!DESTINATIONS.has(as) || SCRIPT_LIKE.has(as)) {
    return "javascript";
  }
  if (as === "json") {
    return "json";
  }
  if (as === "style") {
    return "css";
  }
  if (as === "text") {
    return "text";
  }
  return null;
}

/**
 * Processes a <link rel=modulepreload>: fetches the module into the module map
 * and fires load once the module itself is fetched, without waiting for what it
 * imports; error when it could not be, or when `as` is not a module's.
 * https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload
 */
exports.processModulePreloadLink = element => {
  const document = element._ownerDocument;
  element._preloadFetched = false;
  if (!element.isConnected || !document._defaultView) {
    return;
  }

  const href = element.getAttributeNS(null, "href");
  if (href === null || href === "" || !mediaMatches(element)) {
    return;
  }
  element._preloadFetched = true;

  const generation = (element._preloadGeneration || 0) + 1;
  element._preloadGeneration = generation;
  const fire = type => {
    if (element._preloadGeneration === generation) {
      fireAnEvent(type, element);
    }
  };

  const type = moduleTypeFor((element.getAttributeNS(null, "as") || "").toLowerCase());
  const url = parseURLToResultingURLRecord(href, document);
  if (type === null || url === null) {
    setTimeout(() => fire("error"), 0);
    return;
  }

  const { preloadModuleScript } = require("./module-scripts");
  preloadModuleScript(whatwgURL.serializeURL(url), document._global, type)
    .then(() => "load", () => "error")
    .then(fire);
};
