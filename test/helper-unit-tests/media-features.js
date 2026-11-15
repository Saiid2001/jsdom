"use strict";
const assert = require("node:assert/strict");
const { describe, specify, afterEach } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole, setMediaFeatures } = require("../../lib/api.js");

// The user preferences a page reads through media queries -- prefers-reduced-
// motion, prefers-reduced-transparency, prefers-reduced-data -- answered by the
// host application where it states them. binb states "reduce" for each: a site
// that keeps a lighter page for such a visitor serves it, and binb draws that
// page best. Nothing installed, the answers are a browser's defaults.
// https://drafts.csswg.org/mediaqueries-5/#mf-user-preferences

function page(head = "", body = "") {
  return new JSDOM(`<!DOCTYPE html><head>${head}</head><body>${body}</body>`, {
    url: "http://example.test/", virtualConsole: new VirtualConsole()
  }).window;
}

describe("Helpers: media features a host states", () => {
  afterEach(() => setMediaFeatures(null));

  specify("with nothing installed, every preference is no-preference", () => {
    const window = page();

    assert.equal(window.matchMedia("(prefers-reduced-motion: no-preference)").matches, true);
    assert.equal(window.matchMedia("(prefers-reduced-motion: reduce)").matches, false);
    assert.equal(window.matchMedia("(prefers-reduced-data: no-preference)").matches, true);
    assert.equal(window.matchMedia("(prefers-reduced-data)").matches, false);
  });

  specify("a stated preference answers matchMedia, in both syntaxes and in a boolean context", () => {
    setMediaFeatures({ "prefers-reduced-motion": "reduce", "prefers-reduced-data": "reduce" });
    const window = page();

    assert.equal(window.matchMedia("(prefers-reduced-motion: reduce)").matches, true);
    assert.equal(window.matchMedia("(prefers-reduced-motion)").matches, true);
    assert.equal(window.matchMedia("(prefers-reduced-motion: no-preference)").matches, false);
    assert.equal(window.matchMedia("(prefers-reduced-data: reduce)").matches, true);
    assert.equal(window.matchMedia("(prefers-reduced-transparency: no-preference)").matches, true);
  });

  specify("a stated preference answers the cascade's @media rules", () => {
    setMediaFeatures({ "prefers-reduced-motion": "reduce" });
    const window = page(
      "<style>p { color: red } @media (prefers-reduced-motion: reduce) { p { color: green } }</style>",
      "<p>x</p>"
    );

    assert.equal(window.getComputedStyle(window.document.querySelector("p")).color, "rgb(0, 128, 0)");
  });

  specify("only user preferences can be stated: the viewport's own features are not overridden", () => {
    setMediaFeatures({ "orientation": "portrait", "prefers-reduced-motion": "reduce" });
    const window = page();

    assert.equal(window.matchMedia("(prefers-reduced-motion: reduce)").matches, true);
    assert.equal(window.matchMedia("(orientation: portrait)").matches, false);
  });
});
