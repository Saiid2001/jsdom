"use strict";
const NODE_TYPE = require("../node-type");

// Which elements are painted at a point of the viewport.
//
// jsdom paints nothing, so there is nothing to hit: elementFromPoint() answers
// null and elementsFromPoint() an empty list while nothing is installed here. A
// host application that does paint the document installs its own hit test, and
// those two are answered from what it painted.
//
// The hit test is given a document impl and a point in CSS pixels relative to
// the viewport's top left — the frame elementFromPoint takes, which the caller
// has already checked lies inside the viewport — and returns the element impls
// whose boxes are hit there, topmost first. Returning null is a real answer
// rather than a failure: a document with nothing painted yet has no boxes to
// hit, which is not the same as a point over none of them.

let hitTest = null;

exports.setHitTest = source => {
  hitTest = source;
};

/** The element impls at a viewport point, topmost first, or null where nothing can say. */
exports.elementsAtPoint = (documentImpl, x, y) => {
  if (!hitTest) {
    return null;
  }

  let hits;

  try {
    hits = hitTest(documentImpl, x, y);
  } catch {
    // A hit test that throws is treated as one with no answer, as a geometry
    // source is: the page asking has nothing to do with a renderer's fault.
    return null;
  }

  if (!Array.isArray(hits)) {
    return null;
  }

  // Only this document's elements: a painted scene can hold another document's
  // leftovers for the frames between a navigation and the next paint.
  return hits.filter(hit => hit?.nodeType === NODE_TYPE.ELEMENT_NODE && hit._ownerDocument === documentImpl);
};
