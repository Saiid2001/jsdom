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
  // The user agent's rule is important, so a page's `.form input { display:
  // block }` does not draw its hidden inputs: kbdn.com's three became a 540px
  // empty box at the top of its form.
  specify("a hidden input stays hidden whatever the page says", () => {
    const { window } = new JSDOM(`<style>form input { display: block }</style><form><input type="hidden"></form>`);
    const input = window.document.querySelector("input");

    assert.equal(window.getComputedStyle(input).display, "none");
  });

  for (const name of HIDDEN) {
    specify(`a <${name}> is display: none`, () => {
      const { window } = new JSDOM(`<body>`);
      const element = window.document.createElement(name);

      window.document.body.append(element);

      assert.equal(window.getComputedStyle(element).display, "none");
    });
  }
});
