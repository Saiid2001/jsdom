"use strict";
const MIMEType = require("whatwg-mimetype");
const idlUtils = require("../generated/utils");
const { createCSSModuleStyleSheet } = require("./stylesheets");
const { consumePreloadedResource } = require("./preload");

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

// Who fetches a module into the document's module map without running it, for
// <link rel=modulepreload>. Called with `{ url, window, type, fetchText,
// createStyleSheet }`; it answers with a promise that settles once the module
// itself is fetched, rejecting when it could not be. With nothing installed the
// module's source is fetched and checked, and kept nowhere.
let preloadModule = null;

exports.setModulePreloader = preloader => {
  preloadModule = preloader;
};

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

exports.javaScriptMIMETypeEssences = javaScriptMIMETypeEssences;

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

    // A <link rel=preload as=script crossorigin> for this address is this
    // request: a module script is fetched "cors", with the credentials of
    // crossorigin="anonymous".
    const preloaded = consumePreloadedResource(document, address, {
      destination: "script",
      mode: "cors",
      credentials: "same-origin"
    });

    // A module script is a cors request, which states its origin to another.
    let additionalHeaders;
    try {
      const { origin } = new URL(document.URL);
      additionalHeaders = new URL(address).origin !== origin && origin !== "null" ? { Origin: origin } : undefined;
    } catch {
      additionalHeaders = undefined;
    }

    try {
      pending = preloaded || loader.fetch(address, {
        additionalHeaders,
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
/**
 * Fetches the module at `url` into the window's module map without running it,
 * for <link rel=modulepreload>. `type` is the module type ("javascript", "json",
 * "css" or "text"). Resolves once the module itself is fetched -- a module that
 * does not parse is still fetched -- and rejects when it could not be.
 * https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload
 */
exports.preloadModuleScript = (url, window, type) => {
  function fetchText(address, options) {
    return fetchModuleText(window, address, options);
  }
  if (preloadModule) {
    return Promise.resolve().then(() => preloadModule({
      url, window, type, fetchText, createStyleSheet: createCSSModuleStyleSheet
    }));
  }
  return fetchText(url, { type }).then(() => undefined);
};

exports.runModuleScript = (source, url, window) => {
  function fetchText(address, options) {
    return fetchModuleText(window, address, options);
  }
  return evaluateModule({ source, url, window, fetchText, createStyleSheet: createCSSModuleStyleSheet });
};
