"use strict";

// Who is told when an element's scroll offset changes.
//
// jsdom draws nothing, so an offset is a number and nothing more while nothing
// is installed here. A host application that draws the document installs its
// own sink, and is then told of every change to an element's scrollTop or
// scrollLeft, to scroll what it draws to match.

let sink = null;

exports.setElementScrollSink = source => {
  sink = source;
};

/** Tells the host that `elementImpl` was scrolled to a new offset. */
exports.elementScrolled = elementImpl => {
  if (!sink) {
    return;
  }

  try {
    sink(elementImpl);
  } catch {
    // A sink that throws is a host's fault, and not one for the page that set
    // the offset to see.
  }
};
