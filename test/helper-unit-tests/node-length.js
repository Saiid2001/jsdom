"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://dom.spec.whatwg.org/#concept-node-length
describe("Helpers: a node's length", () => {
  specify("is a CDATA section's data length, as for any character data", () => {
    const { window } = new JSDOM(`<p></p>`);
    const cdata = new window.Document().createCDATASection("1234");
    window.document.querySelector("p").appendChild(cdata);

    const range = window.document.createRange();
    range.selectNodeContents(cdata);

    assert.equal(range.endOffset, 4);
  });
});
