"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");

// A Window keeps its Location and History after its browsing context goes:
// both getters return the object the window was created with. Embedded
// players keep an iframe's contentWindow after removing the iframe and read
// its location later.
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location

function removedFrameWindow() {
  const { window } = new JSDOM(`<!DOCTYPE html><iframe src="about:blank"></iframe>`, {
    url: "http://example.test/",
    virtualConsole: new VirtualConsole()
  });
  const frame = window.document.querySelector("iframe");
  const contentWindow = frame.contentWindow;
  const location = contentWindow.location;
  const history = contentWindow.history;

  frame.remove();

  return { contentWindow, location, history };
}

describe("Helpers: a closed window", () => {
  specify("a removed iframe's window still has its location", () => {
    const { contentWindow, location } = removedFrameWindow();

    assert.equal(contentWindow.location, location);
    assert.equal(contentWindow.location.href, "about:blank");
  });

  specify("a removed iframe's window still has its history", () => {
    const { contentWindow, history } = removedFrameWindow();

    assert.equal(contentWindow.history, history);
  });
});
