"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// An animation that fills forwards is, once it has run, the style of its last
// keyframe. Nothing here runs it, so the cascade takes that end state at once:
// a page faded in by an animation -- animsition, animate.css, a reveal on
// load -- otherwise stayed at the opacity it starts from, and msbm.mb.ca was a
// header over a blank page.
// https://drafts.csswg.org/css-animations-1/#animation-fill-mode

const KEYFRAMES = "@keyframes fade { from { opacity: 0 } to { opacity: 1 } }";

function opacity(css, html = `<div id="x"></div>`) {
  const { window } = new JSDOM(`<style>${KEYFRAMES} ${css}</style>${html}`);

  return window.getComputedStyle(window.document.getElementById("x")).opacity;
}

describe("Helpers: an animation's end state", () => {
  specify("an animation filling forwards or both ends at its last keyframe", () => {
    assert.equal(opacity(`#x { opacity: 0; animation: fade 1s both }`), "1");
    assert.equal(opacity(`#x { opacity: 0; animation: 1.5s ease-in-out 0s 1 forwards fade }`), "1");
    assert.equal(opacity(`#x { opacity: 0; animation-name: fade; animation-duration: 1s; animation-fill-mode: forwards }`), "1");
  });

  specify("one that does not fill, or never ends, leaves the element's own style", () => {
    assert.equal(opacity(`#x { opacity: 0; animation: fade 1s }`), "0");
    assert.equal(opacity(`#x { opacity: 0; animation: fade 1s infinite both }`), "0");
    assert.equal(opacity(`#x { opacity: 0; animation: missing 1s both }`), "0");
  });

  specify("an important declaration still wins", () => {
    assert.equal(opacity(`#x { opacity: 0 !important; animation: fade 1s both }`), "0");
  });

  specify("percentage keyframes, and a list of them, are read", () => {
    const css = `@keyframes rise { 0%, 40% { opacity: 0.2 } 100% { opacity: 0.9 } }
      #x { opacity: 0; animation: rise 1s forwards }`;

    assert.equal(opacity(css), "0.9");
  });

  specify("a class added later starts the animation", () => {
    const { window } = new JSDOM(`<style>${KEYFRAMES} #x { opacity: 0 } .in { animation: fade 1s both }</style><div id="x"></div>`);
    const x = window.document.getElementById("x");

    assert.equal(window.getComputedStyle(x).opacity, "0");
    x.classList.add("in");
    assert.equal(window.getComputedStyle(x).opacity, "1");
  });
});
