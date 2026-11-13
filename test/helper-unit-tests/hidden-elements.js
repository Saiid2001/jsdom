"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// The elements HTML renders nothing of. An <area> is among them: its region is
// the image's, and a box of its own -- an empty inline one -- gave it offsets
// and a client rect where it has none.
// https://html.spec.whatwg.org/multipage/rendering.html#hidden-elements

const HIDDEN = [
  "area", "base", "basefont", "datalist", "head", "link", "meta", "noembed",
  "noframes", "param", "rp", "script", "style", "template", "title"
];

describe("Helpers: hidden elements", () => {
  for (const name of HIDDEN) {
    specify(`a <${name}> is display: none`, () => {
      const { window } = new JSDOM(`<body>`);
      const element = window.document.createElement(name);

      window.document.body.append(element);

      assert.equal(window.getComputedStyle(element).display, "none");
    });
  }
});
