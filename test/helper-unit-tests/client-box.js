"use strict";
const assert = require("node:assert/strict");
const { describe, specify, afterEach } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole, setLayoutGeometry, implSymbol } = require("../../lib/api.js");

// clientWidth, clientHeight, clientTop and clientLeft: an element's padding
// box, and the widths of its top and left borders. Every element but the root
// answered zero, and sliders size their slides from their container's
// clientWidth: greentreeinn.com's set itself 0px wide and showed nothing.
// https://drafts.csswg.org/cssom-view/#dom-element-clientwidth

function page(body) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: "http://example.test/", virtualConsole: new VirtualConsole()
  });

  setLayoutGeometry(element => element._localName === "div" ? { x: 10, y: 20, width: 300, height: 200 } : null);

  return window.document;
}

describe("Helpers: an element's client box", () => {
  afterEach(() => setLayoutGeometry(null));

  specify("with no border, the client box is the border box", () => {
    const div = page(`<div id="x" style="padding: 10px"></div>`).getElementById("x");

    assert.equal(div.clientWidth, 300);
    assert.equal(div.clientHeight, 200);
    assert.equal(div.clientTop, 0);
    assert.equal(div.clientLeft, 0);
  });

  specify("the borders are taken off, and give clientTop and clientLeft", () => {
    const div = page(`<div id="x" style="border: solid; border-width: 1px 2px 3px 4px"></div>`).getElementById("x");

    assert.equal(div.clientWidth, 294);
    assert.equal(div.clientHeight, 196);
    assert.equal(div.clientTop, 1);
    assert.equal(div.clientLeft, 4);
  });

  specify("a border whose style is none has no width", () => {
    const div = page(`<div id="x" style="border-width: 5px"></div>`).getElementById("x");

    assert.equal(div.clientWidth, 300);
    assert.equal(div.clientLeft, 0);
  });

  specify("an inline box, or an element with no box, answers zero", () => {
    const document = page(`<div id="x" style="display: inline; border: 2px solid"></div><p id="y"></p>`);

    assert.equal(document.getElementById("x").clientWidth, 0);
    assert.equal(document.getElementById("x").clientLeft, 0);
    assert.equal(document.getElementById("y").clientWidth, 0);
  });

  specify("the root still answers with the viewport", () => {
    const document = page(``);
    document.defaultView.innerWidth = 800;
    document.defaultView.innerHeight = 600;

    assert.equal(document.documentElement.clientWidth, 800);
    assert.equal(document.documentElement.clientHeight, 600);
  });
});
