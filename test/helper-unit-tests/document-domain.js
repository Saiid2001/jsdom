"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// document.domain is the host of the document's origin. A document made by
// DOMImplementation has the URL about:blank and the origin of the document
// that made it.
describe("Helpers: document.domain", () => {
  const { window } = new JSDOM(``, { url: "http://example.test:8000/page.html" });
  const { document } = window;

  specify("a loaded document's is its host, without the port", () => {
    assert.equal(document.domain, "example.test");
  });

  specify("createDocument() inherits it", () => {
    assert.equal(document.implementation.createDocument(null, "").domain, "example.test");
  });

  specify("createHTMLDocument() inherits it", () => {
    assert.equal(document.implementation.createHTMLDocument("").domain, "example.test");
  });

  specify("DOMParser's document inherits it", () => {
    assert.equal(new window.DOMParser().parseFromString("", "text/html").domain, "example.test");
  });

  specify("an opaque origin has none", () => {
    assert.equal(new JSDOM(``).window.document.domain, "");
  });

  specify("a value set is read back", () => {
    const own = new JSDOM(``, { url: "http://a.example.test/" }).window.document;

    own.domain = "example.test";
    assert.equal(own.domain, "example.test");
  });
});
