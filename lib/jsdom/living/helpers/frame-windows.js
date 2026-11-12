"use strict";

// What the host application gives a frame's window.
//
// A top-level window is handed to the host application, which installs on it
// whatever platform it supplies. A frame's window is made here, when its
// element is inserted, and the host never sees it: a script in the frame then
// has none of what the host supplies, and where the host evaluates scripts in
// a realm of its own, it finds that realm's own facilities in their place. The
// preparer is called with each frame window as it is made, before its document
// is parsed, and the frame element; a function it returns is called when that
// window is closed. The default prepares nothing.

let prepare = null;

exports.setFrameWindowPreparer = preparer => {
  prepare = typeof preparer === "function" ? preparer : null;
};

// What to call when the frame window is closed, or null.
exports.prepareFrameWindow = (frameWindow, frameElement) => {
  if (!prepare) {
    return null;
  }

  const dispose = prepare(frameWindow, frameElement);

  return typeof dispose === "function" ? dispose : null;
};
