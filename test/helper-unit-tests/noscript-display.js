"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// With scripting enabled a browser renders nothing of a <noscript>: the user
// agent style sheet gives it display: none. Rendered, its fallback content was
// painted over the page and took the clicks meant for what was under it.
// https://html.spec.whatwg.org/multipage/rendering.html#hidden-elements

describe("Helpers: noscript display", () => {
  specify("a <noscript> is display: none where scripts run", () => {
    const { window } = new JSDOM(`<noscript>no scripts here</noscript>`, { runScripts: "dangerously" });
    const noscript = window.document.querySelector("noscript");

    assert.equal(window.getComputedStyle(noscript).display, "none");
  });

  specify("a <noscript> is shown where scripts do not run", () => {
    const { window } = new JSDOM(`<noscript><p>no scripts here</p></noscript>`);
    const noscript = window.document.querySelector("noscript");

    assert.notEqual(window.getComputedStyle(noscript).display, "none");
  });
});
