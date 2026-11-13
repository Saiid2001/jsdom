"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// min-width, min-height, max-width and max-height are validated as width and
// height are: a declaration whose value is not one of theirs is dropped at parse
// time, and the cascade falls back to the one before it. Unvalidated, a page's
// own `min-height: px;` -- a template's value with its number missing -- beat
// the theme's `min-height: 600px`, and msbm.mb.ca's banner collapsed to nothing.

function computed(css, property) {
  const { window } = new JSDOM(`<style>${css}</style><div id="x"></div>`);

  return window.getComputedStyle(window.document.getElementById("x")).getPropertyValue(property);
}

describe("Helpers: min and max sizes", () => {
  for (const property of ["min-width", "min-height", "max-width", "max-height"]) {
    specify(`an invalid ${property} is dropped and the earlier one stands`, () => {
      assert.equal(computed(`#x { ${property}: 600px } div#x { ${property}: px }`, property), "600px");
      assert.equal(computed(`#x { ${property}: 600px } div#x { ${property}: -5px }`, property), "600px");
      assert.equal(computed(`#x { ${property}: 600px } div#x { ${property}: foo }`, property), "600px");
    });

    specify(`a valid ${property} applies`, () => {
      for (const value of ["50%", "10em", "calc(100% - 20px)", "min-content"]) {
        assert.equal(computed(`#x { ${property}: 600px } div#x { ${property}: ${value} }`, property), value);
      }
    });
  }

  specify("none is a maximum, and auto a minimum", () => {
    assert.equal(computed(`#x { max-width: 600px } div#x { max-width: none }`, "max-width"), "none");
    assert.equal(computed(`#x { min-height: 600px } div#x { min-height: auto }`, "min-height"), "auto");
    assert.equal(computed(`#x { min-height: 600px } div#x { min-height: none }`, "min-height"), "600px");
  });
});
