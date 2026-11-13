"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// CSS 2.1 §9.7: an absolutely or fixed positioned box does not float, and its
// float computes to none. Kept, tardienta.es's absolutely positioned, floated
// logo was laid out as a float in flow, and its wrapper -- 0px tall in a
// browser -- pushed the navigation under the hero image.

function computedFloat(style) {
  const { window } = new JSDOM(`<div id="x" style="${style}"></div>`);

  return window.getComputedStyle(window.document.getElementById("x")).cssFloat;
}

describe("Helpers: float on a positioned box", () => {
  specify("an absolutely or fixed positioned box does not float", () => {
    assert.equal(computedFloat("float: left; position: absolute"), "none");
    assert.equal(computedFloat("float: right; position: fixed"), "none");
  });

  specify("a relatively positioned or static box keeps its float", () => {
    assert.equal(computedFloat("float: left; position: relative"), "left");
    assert.equal(computedFloat("float: right"), "right");
  });
});
