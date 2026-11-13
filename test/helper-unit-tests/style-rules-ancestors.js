"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A rule whose selector needs an ancestor with some id, class or type is not
// tested against an element none of whose ancestors has it. These are the
// selectors that filter has to leave matching.

function colorOf(html, id) {
  const { window } = new JSDOM(html);

  return window.getComputedStyle(window.document.getElementById(id)).color;
}

const RED = "rgb(255, 0, 0)";

describe("Helpers: style rules and the ancestors they need", () => {
  specify("descendant and child combinators still match", () => {
    assert.equal(colorOf(`<style>.a .b p { color: red }</style><div class="a"><div class="b"><span><p id="x"></p></span></div></div>`, "x"), RED);
    assert.equal(colorOf(`<style>#a > section.b > p { color: red }</style><div id="a"><section class="b"><p id="x"></p></section></div>`, "x"), RED);
    assert.equal(colorOf(`<style>body div p { color: red }</style><div><p id="x"></p></div>`, "x"), RED);
  });

  specify("a selector needing an ancestor the element lacks does not match", () => {
    assert.notEqual(colorOf(`<style>.missing p { color: red }</style><div class="a"><p id="x"></p></div>`, "x"), RED);
    assert.notEqual(colorOf(`<style>.a > p { color: red }</style><div class="a"><span><p id="x"></p></span></div>`, "x"), RED);
  });

  specify("a compound before a sibling combinator is not taken for an ancestor", () => {
    assert.equal(colorOf(`<style>.a ~ .b p { color: red }</style><div><i class="a"></i><div class="b"><p id="x"></p></div></div>`, "x"), RED);
    assert.equal(colorOf(`<style>.w .a + .b > p { color: red }</style><div class="w"><i class="a"></i><div class="b"><p id="x"></p></div></div>`, "x"), RED);
  });

  specify("pseudo classes and attribute selectors in an ancestor still match", () => {
    assert.equal(colorOf(`<style>div:not(.z) .b:first-child p { color: red }</style><div><div class="b"><p id="x"></p></div></div>`, "x"), RED);
    assert.equal(colorOf(`<style>[data-k="a b"] p { color: red }</style><div data-k="a b"><p id="x"></p></div>`, "x"), RED);
    assert.equal(colorOf(`<style>.a:is(div, span) p { color: red }</style><span class="a"><p id="x"></p></span>`, "x"), RED);
  });

  specify("an ancestor's class changing is seen", () => {
    const { window } = new JSDOM(`<style>.on p { color: red }</style><div id="w"><p id="x"></p></div>`);
    const p = window.document.getElementById("x");

    assert.notEqual(window.getComputedStyle(p).color, RED);
    window.document.getElementById("w").className = "on";
    assert.equal(window.getComputedStyle(p).color, RED);
  });
});
