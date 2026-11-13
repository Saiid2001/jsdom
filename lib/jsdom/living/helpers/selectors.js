"use strict";

const nwsapi = require("nwsapi");

const idlUtils = require("../generated/utils");

function initNwsapi(node) {
  const { _globalObject, _ownerDocument } = node;

  const engine = nwsapi({
    document: idlUtils.wrapperForImpl(_ownerDocument),
    DOMException: _globalObject.DOMException
  });
  answerStatePseudoClasses(engine);
  return engine;
}

// :popover-open and :modal name states the DOM does not expose, which nwsapi asks a native matcher for and
// so never finds here. The resolvers it compiles read them off its Snapshot, which is replaced with the
// element's own state where this nwsapi has one.
function answerStatePseudoClasses(engine) {
  const snapshot = engine.Snapshot;
  if (!snapshot) {
    return;
  }
  if (typeof snapshot.isPopoverOpen === "function") {
    snapshot.isPopoverOpen = element => {
      const impl = idlUtils.implForWrapper(element);
      return Boolean(impl) && impl._popoverVisibilityState === "showing";
    };
  }
  if (typeof snapshot.isModal === "function") {
    const fallback = snapshot.isModal;
    snapshot.isModal = element => {
      const impl = idlUtils.implForWrapper(element);
      return (Boolean(impl) && impl._isModal === true) || fallback(element);
    };
  }
}

exports.matchesDontThrow = (elImpl, selector) => {
  const document = elImpl._ownerDocument;

  if (!document._nwsapiDontThrow) {
    document._nwsapiDontThrow = initNwsapi(elImpl);
    document._nwsapiDontThrow.configure({
      LOGERRORS: false,
      VERBOSITY: false,
      IDS_DUPES: true,
      MIXEDCASE: true
    });
  }
  // The cascade matches every rule of every sheet through here, so a selector
  // the matcher cannot evaluate is a rule that does not apply, not a document
  // that cannot be styled. Not only syntax: nwsapi 2.2.20 compiles `:has(~ x)`
  // to `e.parentElement.children` unguarded, which throws on <html>, and one
  // such rule on fr.wikipedia.org failed every getComputedStyle on the page.
  try {
    return document._nwsapiDontThrow.match(selector, idlUtils.wrapperForImpl(elImpl));
  } catch {
    return false;
  }
};

// nwsapi gets `document.documentElement` at creation-time, so we have to initialize lazily, since in the initial
// stages of Document initialization, there is no documentElement present yet.
exports.addNwsapi = parentNode => {
  const document = parentNode._ownerDocument;

  if (!document._nwsapi) {
    document._nwsapi = initNwsapi(parentNode);
    document._nwsapi.configure({
      LOGERRORS: false,
      IDS_DUPES: true,
      MIXEDCASE: true
    });
  }

  return document._nwsapi;
};
