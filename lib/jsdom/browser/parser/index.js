"use strict";

const xmlParser = require("./xml");
const htmlParser = require("./html");
const moduleClock = require("../../living/helpers/module-clock");

// https://w3c.github.io/DOM-Parsing/#dfn-fragment-parsing-algorithm
// `options.allowDeclarativeShadowRoots` reaches the HTML parser only; XML has no declarative shadow DOM.
function parseFragment(markup, contextElement, options) {
  const { _parsingMode } = contextElement._ownerDocument;

  let parseAlgorithm;
  if (_parsingMode === "html") {
    parseAlgorithm = htmlParser.parseFragment;
  } else if (_parsingMode === "xml") {
    parseAlgorithm = xmlParser.parseFragment;
  }

  // Note: HTML and XML fragment parsing algorithm already return a document fragments; no need to do steps 3 and 4
  const clockToken = moduleClock.enter("dom", contextElement._ownerDocument._globalObject);
  try {
    return parseAlgorithm(markup, contextElement, options);
  } finally {
    moduleClock.exit(clockToken);
  }
}

function parseIntoDocument(markup, ownerDocument, options) {
  const { _parsingMode } = ownerDocument;

  let parseAlgorithm;
  if (_parsingMode === "html") {
    parseAlgorithm = htmlParser.parseIntoDocument;
  } else if (_parsingMode === "xml") {
    parseAlgorithm = xmlParser.parseIntoDocument;
  }

  const clockToken = moduleClock.enter("dom", ownerDocument._globalObject);
  try {
    return parseAlgorithm(markup, ownerDocument, options);
  } finally {
    moduleClock.exit(clockToken);
  }
}

// A document a window loads, whose parser waits on parser-blocking scripts; `onParsed` runs once it reaches the end.
// XML is parsed at once.
function parseIntoLoadingDocument(markup, ownerDocument, onParsed) {
  if (ownerDocument._parsingMode === "html") {
    htmlParser.parseIntoLoadingDocument(markup, ownerDocument, onParsed);
    return;
  }

  xmlParser.parseIntoDocument(markup, ownerDocument);
  onParsed();
}

module.exports = {
  parseFragment,
  parseIntoDocument,
  parseIntoLoadingDocument
};
