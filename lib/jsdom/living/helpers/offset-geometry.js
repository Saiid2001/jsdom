"use strict";

const { borderBoxOf } = require("./layout-geometry");
const { computedStyle } = require("./style-rules");
const { HTML_NS } = require("./namespaces");

// https://drafts.csswg.org/cssom-view/#extensions-to-the-htmlelement-interface
//
// Read from the laid out border boxes and each ancestor's computed position,
// which computedStyle keeps per style generation, so the walk up costs a lookup
// per ancestor. Answering null for every element read as "not displayed" to
// anything that tests offsetParent for it: react-virtuoso ignores the resizes of
// such an element, and its lists never learned a height and rendered no rows.

// An unset position reads back empty, and is the initial static.
const positionOf = elementImpl => computedStyle(elementImpl).getPropertyValue("position") || "static";

const isHTML = (elementImpl, localName) =>
  elementImpl.namespaceURI === HTML_NS && elementImpl.localName === localName;

exports.offsetParentOf = elementImpl => {
  const document = elementImpl._ownerDocument;

  if (!elementImpl.isConnected || elementImpl === document.documentElement || isHTML(elementImpl, "body")) {
    return null;
  }

  const position = positionOf(elementImpl);

  if (position === "fixed" || borderBoxOf(elementImpl) === null) {
    return null;
  }

  for (let ancestor = elementImpl.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (positionOf(ancestor) !== "static") {
      return ancestor;
    }

    if (isHTML(ancestor, "body")) {
      return ancestor;
    }

    if (position === "static" &&
        (isHTML(ancestor, "td") || isHTML(ancestor, "th") || isHTML(ancestor, "table"))) {
      return ancestor;
    }
  }

  return null;
};

/**
 * offsetLeft and offsetTop: from the offsetParent's padding edge, or from the
 * page origin where the offsetParent is the body or there is none.
 */
exports.offsetOf = (elementImpl, axis) => {
  const box = borderBoxOf(elementImpl);

  if (box === null) {
    return 0;
  }

  const parent = exports.offsetParentOf(elementImpl);
  const coordinate = axis === "left" ? box.x : box.y;

  if (parent === null || isHTML(parent, "body")) {
    const view = elementImpl._ownerDocument._defaultView;
    const scroll = view ? Number(axis === "left" ? view.pageXOffset : view.pageYOffset) || 0 : 0;

    return Math.round(coordinate + scroll);
  }

  const parentBox = borderBoxOf(parent);

  if (parentBox === null) {
    return 0;
  }

  const border = parseFloat(computedStyle(parent).getPropertyValue(`border-${axis}-width`)) || 0;

  return Math.round(coordinate - (axis === "left" ? parentBox.x : parentBox.y) - border);
};
