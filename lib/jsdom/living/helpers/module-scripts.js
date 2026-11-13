"use strict";
const MIMEType = require("whatwg-mimetype");
const idlUtils = require("../generated/utils");
const { createCSSModuleStyleSheet } = require("./stylesheets");
const { bytesMatchMetadata, hasIntegrityMetadata } = require("./integrity");
const { blockedByNosniff } = require("./content-type");
const { isEligibleForIntegrity } = require("./subresource-checks");

// Who runs a module script.
//
// This library evaluates classic scripts and drops every other kind, which for
// `type="module"` means the page's own code never runs and the document simply
// comes out short. Implementing modules needs a loader — a graph to resolve,
// fetch and evaluate in order — and that belongs to whatever is already
// fetching this document's subresources, not here.
//
// With nothing installed the old behaviour stands: a module script is ignored,
// which is the honest report for a library that cannot run one.

let evaluateModule = null;

exports.setModuleEvaluator = evaluator => {
  evaluateModule = evaluator;
};

exports.hasModuleEvaluator = () => evaluateModule !== null;

const javaScriptMIMETypeEssences = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript"
]);

// Whether a response's content type may be used as a module of the given type. A response that names no type at all
// (a data: URL with none, or a loader that does not report headers) is let through.
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
function contentTypeAllows(contentType, type) {
  // A text module is the text of whatever was answered.
  if (type === "text" || contentType === undefined || contentType === null) {
    return true;
  }
  const mimeType = MIMEType.parse(contentType);
  if (!mimeType) {
    return false;
  }
  const { essence } = mimeType;
  switch (type) {
    case "json":
      return essence === "application/json" || essence === "text/json" || mimeType.subtype.endsWith("+json");
    case "css":
      return essence === "text/css";
    default:
      return javaScriptMIMETypeEssences.has(essence);
  }
}

function headerOf(response, name) {
  const { headers } = response;
  if (!headers) {
    return undefined;
  }
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  return headers[name];
}

/**
 * Fetches one module's source for a window's document, as text.
 *
 * Through the window's resource loader rather than the document's: the document's enqueues what it fetches, and a
 * module is fetched from inside a queue entry that is waiting for it, which deadlocks.
 *
 * Text rather than a response: a response body is read once, and the loader hands every concurrent caller of one
 * address the same response, so the second module to read it would find it already consumed.
 *
 * `type` is the module type the request is for ("javascript", "json", "css" or "text"); a response whose content type
 * is not that type is a failed fetch, as is one answered outside 2xx.
 */
function fetchModuleText(window, address, { type = "javascript", referrer } = {}) {
  return new Promise((resolve, reject) => {
    const loader = window && window._resourceLoader;
    const document = window && window._document ? idlUtils.implForWrapper(window._document) : null;
    let pending;

    if (!loader || !document) {
      reject(new Error("No resource loader to fetch a module with"));
      return;
    }

    try {
      pending = loader.fetch(address, {
        cookieJar: document._cookieJar,
        referrer: referrer || document.URL,
        // A module script is fetched in "cors" mode, destination "script".
        mode: "cors",
        destination: "script"
      });
    } catch (error) {
      reject(error);
      return;
    }

    if (!pending) {
      reject(new Error(`Could not request module ${address}`));
      return;
    }

    pending.then(data => {
      const { response } = pending;
      const statusCode = response ? response.statusCode : undefined;
      if (typeof statusCode === "number" && (statusCode < 200 || statusCode > 299)) {
        reject(new Error(`Module ${address} was answered ${statusCode}`));
        return;
      }

      const contentType = response ? headerOf(response, "content-type") : undefined;
      if (!contentTypeAllows(contentType, type)) {
        reject(new Error(`Module ${address} was answered with ${contentType}, which is not a ${type} module`));
        return;
      }

      const destination = { json: "json", css: "style" }[type] || "script";
      if (response && response.headers && blockedByNosniff(response.headers, destination)) {
        reject(new Error(`Module ${address} was answered with nosniff and a type that is not a ${type} module`));
        return;
      }

      // The integrity metadata of the module script element whose entry this
      // is; its imports are fetched with none.
      // https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
      const entry = takeEntryIntegrity(window, address);
      if (entry && hasIntegrityMetadata(entry.integrity)) {
        const responseURL = (typeof pending.href === "string" && pending.href) || address;
        const eligible = isEligibleForIntegrity({
          element: null,
          responseURL,
          headers: response ? response.headers : null,
          documentOrigin: originOf(document.URL),
          credentialsMode: entry.credentialsMode
        });

        if (!eligible || !bytesMatchMetadata(data, entry.integrity)) {
          reject(new Error(`Module ${address} does not match its integrity metadata`));
          return;
        }
      }

      // A module is UTF-8 whatever it declares, and a byte order mark is honoured only when it is UTF-8's: a UTF-16
      // one stays in the text, where it is a parse error.
      // https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
      resolve(new TextDecoder("utf-8").decode(data));
    }, reject);
  });
}

exports.fetchModuleText = fetchModuleText;

/**
 * Hands one module script over to be run.
 *
 * `source` is the entry module's text and `url` the address to resolve its
 * imports against — for an inline module, the document's base URL. The rest of
 * the graph is fetched through `fetchText`, which goes through this document's
 * own resource loader so that a module is requested the way every other
 * subresource is; a CSS module's style sheet is made by `createStyleSheet`.
 */
// The integrity metadata an external module script element was prepared with,
// by the address of its entry, until the entry's fetch takes it.
function setEntryIntegrity(window, url, integrity, credentialsMode) {
  if (!window._moduleEntryIntegrity) {
    window._moduleEntryIntegrity = new Map();
  }
  window._moduleEntryIntegrity.set(url, { integrity, credentialsMode });
}

function takeEntryIntegrity(window, url) {
  const entries = window && window._moduleEntryIntegrity;
  if (!entries || !entries.has(url)) {
    return null;
  }
  const entry = entries.get(url);
  entries.delete(url);
  return entry;
}

function originOf(urlString) {
  try {
    return new URL(urlString).origin;
  } catch {
    return null;
  }
}

// `integrity` and `credentialsMode` are the entry's, for an external module
// script: a module script is always fetched in "cors" mode, with the element's
// crossorigin attribute deciding the credentials.
exports.runModuleScript = (source, url, window, { integrity = "", credentialsMode = "same-origin" } = {}) => {
  if (source === undefined && hasIntegrityMetadata(integrity)) {
    setEntryIntegrity(window, url, integrity, credentialsMode);
  }

  function fetchText(address, options) {
    return fetchModuleText(window, address, options);
  }
  return evaluateModule({ source, url, window, fetchText, createStyleSheet: createCSSModuleStyleSheet });
};
