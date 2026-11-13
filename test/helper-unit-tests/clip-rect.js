"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// CSS 2.1 lets a rect() be written with or without commas, and browsers read
// both. cssstyle read only commas and dropped `clip: rect(0 0 0 0)`, the form
// Liferay's visually hidden text uses, so the text was drawn: tardienta.es's
// "Contacto" lay over its envelope icon.
// https://www.w3.org/TR/CSS21/visufx.html#value-def-shape

function clip(value) {
  const { window } = new JSDOM(`<div id="x" style="position: absolute; clip: ${value}"></div>`);

  return window.getComputedStyle(window.document.getElementById("x")).clip;
}

describe("Helpers: clip rect()", () => {
  specify("a rect() written without commas is read", () => {
    assert.equal(clip("rect(0 0 0 0)"), "rect(0px, 0px, 0px, 0px)");
    assert.equal(clip("rect(1px 10px 5px 2px)"), "rect(1px, 10px, 5px, 2px)");
  });

  specify("a rect() with commas still is, and auto edges are kept", () => {
    assert.equal(clip("rect(1px, 1px, 1px, 1px)"), "rect(1px, 1px, 1px, 1px)");
    assert.equal(clip("rect(auto, 10px, auto, 0)"), "rect(auto, 10px, auto, 0px)");
  });
});
