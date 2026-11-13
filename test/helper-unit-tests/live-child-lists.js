"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");
const idlUtils = require("../../lib/jsdom/living/generated/utils.js");

// A node's childNodes and children are brought up to date when they are read,
// not each time the node changes: rebuilt on every change, a list once read
// made each insertion cost as much as every child already there, and parsing
// 65,000 rows into a table body whose childNodes a layout had read took
// minutes instead of seconds.

function countQueries(list) {
  const impl = idlUtils.implForWrapper(list);
  const query = impl._query;
  const counter = { count: 0 };

  impl._query = () => {
    counter.count++;
    return query();
  };

  return counter;
}

describe("Helpers: live child lists", () => {
  specify("childNodes is not rebuilt for each child appended", () => {
    const { window } = new JSDOM(`<ul></ul>`);
    const list = window.document.querySelector("ul");
    const queries = countQueries(list.childNodes);

    for (let i = 0; i < 100; i++) {
      list.append(window.document.createElement("li"));
    }

    assert.equal(queries.count, 0);
    assert.equal(list.childNodes.length, 100);
    assert.equal(queries.count, 1);
  });

  specify("children is not rebuilt for each child appended", () => {
    const { window } = new JSDOM(`<ul></ul>`);
    const list = window.document.querySelector("ul");
    const queries = countQueries(list.children);

    for (let i = 0; i < 100; i++) {
      list.append(window.document.createElement("li"));
    }

    assert.equal(queries.count, 0);
    assert.equal(list.children.length, 100);
    assert.equal(queries.count, 1);
  });

  specify("a list held across changes reads the children as they are", () => {
    const { window } = new JSDOM(`<ul><li id=a></li><li id=b></li></ul>`);
    const ul = window.document.querySelector("ul");
    const nodes = ul.childNodes;
    const elements = ul.children;

    ul.firstChild.remove();
    ul.append(window.document.createElement("p"));

    assert.deepEqual([...nodes].map(node => node.localName), ["li", "p"]);
    assert.equal(nodes[0].id, "b");
    assert.equal(elements.length, 2);
    assert.equal(elements.item(1).localName, "p");
    assert.equal(elements.namedItem("b"), ul.firstChild);
  });
});
