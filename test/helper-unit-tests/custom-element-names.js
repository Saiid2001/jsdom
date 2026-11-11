"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");
const { isValidCustomElementName } = require("../../lib/jsdom/living/helpers/custom-elements.js");

// https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name
describe("Helpers: valid custom element names", () => {
  specify("a name is a valid element local name starting with a lowercase ASCII letter, with a hyphen", () => {
    for (const name of ["a-b", "a-", "a-\u0080", "a-\u{1F171}", "a.b-c", "a:b-c", "a-B".toLowerCase(),
      "a-·", "a-!", "a-\u0001", "a-\u{10000}", "annotation-xml-custom", "a⁰-b"]) {
      assert.equal(isValidCustomElementName(name), true, JSON.stringify(name));
    }
  });

  specify("names that are not valid", () => {
    for (const name of ["", "a", "-a", "A-b", "a-B", "1-a", "é-a", "a- ", "a-/", "a->", "a-\0", "a-\t",
      "a-\n", "a-\f", "a-\r", "annotation-xml", "font-face", "missing-glyph"]) {
      assert.equal(isValidCustomElementName(name), false, JSON.stringify(name));
    }
  });

  specify("define accepts a constructor whose prototype is a function", () => {
    const { window } = new JSDOM(``);
    const ctor = function () {};
    ctor.prototype = window.HTMLElement;
    window.customElements.define("x-fn-proto", ctor);
    assert.equal(window.customElements.get("x-fn-proto"), ctor);
  });

  specify("define and whenDefined use the new rule", () => {
    const { window } = new JSDOM(``);
    class A extends window.HTMLElement {}
    window.customElements.define("a-\u{1F171}", A);
    assert.equal(window.customElements.get("a-\u{1F171}"), A);
    assert.throws(() => window.customElements.define("a-b c", class extends window.HTMLElement {}),
      e => e.name === "SyntaxError");
  });
});
