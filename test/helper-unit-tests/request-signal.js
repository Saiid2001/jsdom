"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A Request follows the signal its init gives it. RequestInit's converter
// hands that signal over as an impl, and AbortSignal.any takes wrappers, so
// constructing a Request with a signal threw.
// https://fetch.spec.whatwg.org/#dom-request

function page() {
  return new JSDOM("", { url: "https://example.test/" }).window;
}

describe("Helpers: a Request's signal", () => {
  specify("a Request made with a signal follows it", () => {
    const window = page();
    const controller = new window.AbortController();
    const request = new window.Request("/a", { signal: controller.signal });

    assert.equal(request.signal.aborted, false);
    controller.abort();
    assert.equal(request.signal.aborted, true);
  });

  specify("a Request made from one with a signal follows that signal", () => {
    const window = page();
    const controller = new window.AbortController();
    const copy = new window.Request(new window.Request("/a", { signal: controller.signal }));

    controller.abort();
    assert.equal(copy.signal.aborted, true);
  });

  specify("an already aborted signal makes an aborted Request", () => {
    const window = page();
    const request = new window.Request("/a", { signal: window.AbortSignal.abort() });

    assert.equal(request.signal.aborted, true);
  });
});
