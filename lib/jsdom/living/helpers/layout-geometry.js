"use strict";

// Where an element's laid out geometry comes from.
//
// jsdom lays nothing out, so every box metric is zero. That is the honest
// report for a DOM with no layout behind it, and it stays the answer while
// nothing is installed here. A host application that does lay the document out
// installs its own source, and the metrics below are then read from whatever it
// computed.
//
// The source is asked for one element's border box in CSS pixels, relative to
// the viewport's top left — the frame getBoundingClientRect reports in, so a
// box scrolled above the viewport has a negative `y`. Returning null is a real
// answer rather than a failure: an element with `display: none`, or one the
// layout never reached, has no box.

let boxSource = null;

exports.setLayoutGeometry = source => {
  boxSource = source;
};

// A box whose numbers are not all finite is worse than no box: it propagates
// into every comparison a caller makes, and NaN fails them all silently.
function usable(box) {
  return box !== null &&
    typeof box === "object" &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height);
}

/** One element's border box, or null where there is no layout to ask. */
exports.borderBoxOf = elementImpl => {
  if (!boxSource) {
    return null;
  }

  let box;

  try {
    box = boxSource(elementImpl);
  } catch {
    // A source that throws is treated as a source with no answer: a geometry
    // read is not a place to surface a renderer's internal fault, and a page
    // asking for a rect cannot do anything with the exception.
    return null;
  }

  return usable(box)
    ? { x: box.x, y: box.y, width: box.width, height: box.height }
    : null;
};
