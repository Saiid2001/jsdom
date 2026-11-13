"use strict";
const idlUtils = require("../generated/utils");
const DOMException = require("../generated/DOMException");
const { isSecureContext } = require("./secure-context");
const { fetchSite } = require("./fetch-metadata");

// The Storage Access API (https://privacycg.github.io/storage-access/).
//
// Access is granted where a browser grants it without asking: to a top-level
// document and to one same-site with its top-level document. A cross-site
// document would need the user's permission, and there is no prompt to ask it
// with, so it is refused, as a denied permission is.

function topLevelDocumentOf(documentImpl) {
  let window = documentImpl._defaultView;

  while (window && window._parent && window._parent !== window._globalProxy) {
    window = window._parent;
  }

  return window && window._document ? idlUtils.implForWrapper(window._document) : documentImpl;
}

// Whether a document is first-party: top-level, or its origin same-site with
// that of the document at the top. The origin rather than the URL: a frame at
// about:blank has its parent's.
function isFirstParty(documentImpl, top) {
  return top === documentImpl ||
    fetchSite(top._origin, documentImpl._origin) !== "cross-site";
}

function reject(documentImpl, message, name) {
  return Promise.reject(DOMException.create(documentImpl._globalObject, [message, name]));
}

// https://privacycg.github.io/storage-access/#dom-document-hasstorageaccess
exports.hasStorageAccess = documentImpl => {
  if (!documentImpl._isFullyActive()) {
    return reject(documentImpl, "The document is not fully active.", "InvalidStateError");
  }

  if (documentImpl._origin === "null" || !isSecureContext(documentImpl)) {
    return Promise.resolve(false);
  }

  const top = topLevelDocumentOf(documentImpl);

  if (top._origin === "null") {
    return Promise.resolve(false);
  }

  return Promise.resolve(isFirstParty(documentImpl, top) || documentImpl._hasStorageAccess === true);
};

// https://privacycg.github.io/storage-access/#dom-document-requeststorageaccess
exports.requestStorageAccess = documentImpl => {
  if (!documentImpl._isFullyActive()) {
    return reject(documentImpl, "The document is not fully active.", "InvalidStateError");
  }

  const top = topLevelDocumentOf(documentImpl);

  if (!isSecureContext(documentImpl) || documentImpl._origin === "null" || top._origin === "null") {
    return reject(documentImpl, "Storage access is not available to this document.", "NotAllowedError");
  }

  if (!isFirstParty(documentImpl, top)) {
    return reject(documentImpl, "Storage access was not granted.", "NotAllowedError");
  }

  documentImpl._hasStorageAccess = true;
  return Promise.resolve(undefined);
};
