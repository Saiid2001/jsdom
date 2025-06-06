"use strict";
const whatwgURL = require("whatwg-url");
const notImplemented = require("../../browser/not-implemented.js");
const reportException = require("../helpers/runtime-script-errors.js");
const idlUtils = require("../generated/utils.js");
const { fireAnEvent } = require("../helpers/events.js");

exports.evaluateJavaScriptURL = (window, urlRecord) => {
  const urlString =
    typeof urlRecord === "string"
      ? urlRecord
      : whatwgURL.serializeURL(urlRecord);
  const encodedScriptSource = urlString.substring("javascript:".length);
  const scriptSource = Buffer.from(
    whatwgURL.percentDecodeString(encodedScriptSource)
  ).toString();
  if (window._runScripts === "dangerously") {
    try {
      return window.eval(scriptSource);
    } catch (e) {
      reportException(window, e, urlString);
    }
  }
  return undefined;
};

// https://html.spec.whatwg.org/#navigating-across-documents
exports.navigate = (window, newURL, flags = {}, documentResource = null) => {
  // This is NOT a spec-compliant implementation of navigation in any way. It implements a few selective steps that
  // are nice for jsdom users, regarding hash changes and JavaScript URLs. Full navigation support is being worked on
  // and will likely require some additional hooks to be implemented.
  
  if (!window._document) {
    return;
  }

  const document = idlUtils.implForWrapper(window._document);
  const currentURL = document._URL;

  if (
    !flags.reloadTriggered &&
    urlEquals(currentURL, newURL, { excludeFragments: true })
  ) {
    if (newURL.fragment !== currentURL.fragment) {
      navigateToFragment(window, newURL, flags);
    }
    return;
  }


  // NOT IMPLEMENTED: Prompt to unload the active document of browsingContext.

  // NOT IMPLEMENTED: form submission algorithm
  // const navigationType = 'other';

  // NOT IMPLEMENTED: if resource is a response...
  if (newURL.scheme === "javascript") {
    setTimeout(() => {
      const result = exports.evaluateJavaScriptURL(window, newURL);
      if (typeof result === "string") {
        notImplemented("string results from 'javascript:' URLs", window);
      }
    }, 0);
    return;
  }
  navigateFetch(window, newURL, flags, documentResource);
};

// https://html.spec.whatwg.org/#scroll-to-fragid
function navigateToFragment(window, newURL, flags) {
  const document = idlUtils.implForWrapper(window._document);

  window._sessionHistory.clearHistoryTraversalTasks();

  if (!flags.replacement) {
    // handling replacement=true here deviates from spec, but matches real browser behaviour
    // see https://github.com/whatwg/html/issues/2796 for spec bug
    window._sessionHistory.removeAllEntriesAfterCurrentEntry();
  }
  const newEntry = { document, url: newURL };
  window._sessionHistory.addEntryAfterCurrentEntry(newEntry);
  window._sessionHistory.traverseHistory(newEntry, {
    nonBlockingEvents: true,
    replacement: flags.replacement,
  });
}

// https://html.spec.whatwg.org/#process-a-navigate-fetch
function navigateFetch(window, newURL, flags, documentResource = null) {
  // just create a navigation event from the window and then the browser will handle it

  // Dispatch the event on the window
  // fireAnEvent("navigate", window, undefined, {
  //   bubbles: false,
  //   cancelable: false,
  //   composed: true,
  //   detail: {
  //     navigation: {
  //       url: newURL,
  //       flags: flags || {},
  //       documentResource: documentResource || null,
  //     },
  //   },
  // });

  const document = idlUtils.implForWrapper(window._document);
  const customEvent = document.createEvent("customevent");
  customEvent.initCustomEvent("navigate", false, false, {
    url: typeof newURL === "string" ? newURL : whatwgURL.serializeURL(newURL),
    flags: flags || {},
    documentResource: documentResource || null,
  });
  
  document.dispatchEvent(customEvent);
}

// https://url.spec.whatwg.org/#concept-url-equals
function urlEquals(a, b, flags) {
  const serializedA =
    typeof a === "string"
      ? a
      : whatwgURL.serializeURL(a, flags.excludeFragments);
  const serializedB =
    typeof b === "string"
      ? b
      : whatwgURL.serializeURL(b, flags.excludeFragments);

  return serializedA === serializedB;
}
