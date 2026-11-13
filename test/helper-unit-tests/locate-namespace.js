"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://dom.spec.whatwg.org/#locate-a-namespace: the xml and xmlns prefixes are bound on every element.
describe("Helpers: locating a namespace", () => {
  specify("an element, and an attribute through it, has the xml and xmlns prefixes bound", () => {
    const { document } = new JSDOM(`<div><p></p></div>`).window;
    const p = document.querySelector("p");
    const attr = document.createAttribute("a");
    p.setAttributeNode(attr);

    for (const node of [document.body, p, attr, document]) {
      assert.equal(node.lookupNamespaceURI("xml"), "http://www.w3.org/XML/1998/namespace");
      assert.equal(node.lookupNamespaceURI("xmlns"), "http://www.w3.org/2000/xmlns/");
    }
    assert.equal(document.createDocumentFragment().lookupNamespaceURI("xml"), null);
    assert.equal(document.createElement("div").lookupNamespaceURI("other"), null);
  });
});
