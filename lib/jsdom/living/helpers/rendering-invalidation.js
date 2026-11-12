"use strict";

// How an element renders can change with no mutation to record: a popover is shown or hidden, an element enters or
// leaves the top layer. A MutationObserver hears none of it, so a host application that paints the document from
// mutation records would keep painting the old state. It installs a listener here, which is given the element impl
// whose rendering changed, synchronously, from inside the algorithm that changed it.
//
// Nothing is told while nothing is installed. A listener that throws is ignored: the page whose state changed has
// nothing to do with a renderer's fault.

let listener = null;

exports.setRenderingInvalidation = source => {
  listener = source;
};

exports.invalidateRendering = elementImpl => {
  if (!listener) {
    return;
  }

  try {
    listener(elementImpl);
  } catch {
    // See above.
  }
};
