"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://dom.spec.whatwg.org/#valid-element-local-name and its siblings, the
// rules whatwg/dom#1079 relaxed names to.
describe("Helpers: name validation", () => {
  const { window } = new JSDOM();
  const { document } = window;
  function invalid(fn) {
    assert.throws(fn, error => error.name === "InvalidCharacterError");
  }

  specify("an element local name starting with a letter may hold anything but space, NULL, / and >", () => {
    for (const name of ["a<b", "a{", "aé", "aé🆖", "x=1", "a'b"]) {
      assert.equal(document.createElement(name).localName, name.toLowerCase());
    }
    for (const name of ["", "a b", "a\0", "a/", "a>"]) {
      invalid(() => document.createElement(name));
    }
  });

  specify("one starting otherwise must start with :, _ or a non-ASCII code point, then name characters", () => {
    for (const name of [":a", "_a", "éa", "_-.:9", "🆖"]) {
      document.createElement(name);
    }
    for (const name of ["5", "-a", ".a", "_{", ":a<", "\u0001"]) {
      invalid(() => document.createElement(name));
    }
  });

  specify("an attribute local name may hold anything but space, NULL, /, = and >", () => {
    const element = document.createElement("div");
    for (const name of ["a<b", "{", "\u0001", ":", "5"]) {
      element.setAttribute(name, "v");
      element.toggleAttribute(name);
      document.createAttribute(name);
    }
    for (const name of ["", "a b", "a\0", "a/", "a=", "a>"]) {
      invalid(() => element.setAttribute(name, "v"));
      invalid(() => element.toggleAttribute(name));
      invalid(() => document.createAttribute(name));
    }
  });

  specify("a qualified name splits at its first colon; a prefix is not empty and has no space, NULL, / or >", () => {
    assert.equal(document.createElementNS("urn:x", "f::oo").localName, ":oo");
    assert.equal(document.createElementNS("urn:x", "f:o:o").localName, "o:o");
    assert.equal(document.createElementNS("urn:x", "0:a").prefix, "0");
    assert.equal(document.createAttributeNS("urn:x", "p:5").localName, "5");
    invalid(() => document.createElementNS("urn:x", ":a"));
    invalid(() => document.createElementNS("urn:x", "a:"));
    invalid(() => document.createElementNS("urn:x", "a:0"));
    invalid(() => document.createElementNS("urn:x", "a b:c"));
    invalid(() => document.createAttributeNS("urn:x", "p:a="));
    assert.throws(() => document.createElementNS(null, "f:oo"), error => error.name === "NamespaceError");
  });

  specify("a doctype name may be empty and may hold anything but space, NULL and >", () => {
    assert.equal(document.implementation.createDocumentType("", "", "").name, "");
    assert.equal(document.implementation.createDocumentType("a:b:c<", "", "").name, "a:b:c<");
    invalid(() => document.implementation.createDocumentType("a b", "", ""));
    invalid(() => document.implementation.createDocumentType("a>", "", ""));
  });

  specify("a processing instruction target is still an XML Name", () => {
    invalid(() => document.createProcessingInstruction("a<b", "x"));
  });
});
