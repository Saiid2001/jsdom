"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// The cascade's rule index keys a rule under the rightmost compound selector of
// each branch, found by splitting the branch on combinators. An escaped
// character is part of the name it sits in: `#a\ b` is one id selector naming
// "a b", not a descendant combinator before a type selector `b`. A property
// no rule sets computes to "" here, which is how a rule that does not apply
// is told apart.

/** The cascaded `z-index` of the element carrying `data-t`, given a sheet and a body. */
function zIndexOf(css, body) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><style>${css}</style></head><body>${body}</body></html>`
  );
  const element = dom.window.document.querySelector("[data-t]");
  const value = dom.window.getComputedStyle(element).getPropertyValue("z-index");

  dom.window.close();

  return value;
}

describe("Helpers: style-rules escaped selectors", () => {
  specify("an id holding an escaped space", () => {
    assert.equal(zIndexOf(`#a\\ b { position: absolute; z-index: 3; }`, `<div id="a b" data-t></div>`), "3");
  });

  specify("an id holding an escaped combinator", () => {
    assert.equal(zIndexOf(`#a\\>b { position: absolute; z-index: 3; }`, `<div id="a>b" data-t></div>`), "3");
    assert.equal(zIndexOf(`#a\\+b { position: absolute; z-index: 3; }`, `<div id="a+b" data-t></div>`), "3");
  });

  specify("a class holding an escaped comma", () => {
    assert.equal(zIndexOf(`.a\\,b { position: absolute; z-index: 3; }`, `<div class="a,b" data-t></div>`), "3");
  });

  specify("an escape in an ancestor compound leaves the rightmost one indexed", () => {
    assert.equal(zIndexOf(`.sm\\:wide #x { position: absolute; z-index: 3; }`, `<div class="sm:wide"><p id="x" data-t></p></div>`), "3");
    assert.equal(zIndexOf(`.sm\\:wide #x { position: absolute; z-index: 3; }`, `<div class="sm:wide"><p id="y" data-t></p></div>`), "");
  });

  specify("an escaped space does not make the element a descendant of a type", () => {
    assert.equal(zIndexOf(`#a\\ b { position: absolute; z-index: 3; }`, `<b><div id="a" data-t></div></b>`), "");
  });
});
