"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole, setFrameWindowPreparer } = require("../../lib/api.js");

// A top-level window is handed to the host application, which installs what it
// supplies on it. A frame's window is made here, when its element is inserted,
// and is handed over through the preparer as it is made, before its document is
// parsed. What the preparer returns runs when that window is closed.

function page() {
  return new JSDOM(`<!DOCTYPE html><body></body>`, {
    url: "http://example.test/",
    virtualConsole: new VirtualConsole()
  }).window;
}

describe("Helpers: the frame window preparer", () => {
  specify("an inserted iframe's window is prepared, with its element", () => {
    const window = page();
    const seen = [];

    setFrameWindowPreparer((frameWindow, frame) => {
      seen.push([frameWindow, frame]);
      frameWindow.prepared = true;
    });

    try {
      const frame = window.document.createElement("iframe");
      window.document.body.appendChild(frame);

      assert.equal(seen.length, 1);
      assert.equal(seen[0][0], frame.contentWindow);
      assert.equal(seen[0][1], frame);
      assert.equal(frame.contentWindow.prepared, true);
    } finally {
      setFrameWindowPreparer(null);
    }
  });

  specify("what the preparer returns runs when the frame is removed", () => {
    const window = page();
    let disposed = 0;

    setFrameWindowPreparer(() => () => {
      disposed++;
    });

    try {
      const frame = window.document.createElement("iframe");
      window.document.body.appendChild(frame);
      assert.equal(disposed, 0);

      frame.remove();
      assert.equal(disposed, 1);
    } finally {
      setFrameWindowPreparer(null);
    }
  });

  specify("a frame is made as before with no preparer", () => {
    const window = page();
    const frame = window.document.createElement("iframe");

    window.document.body.appendChild(frame);

    assert.equal(frame.contentDocument.body.localName, "body");
  });
});
