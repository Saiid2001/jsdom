"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A style sheet whose <style> or <link> carries a media attribute applies only
// while that media query list matches. A print sheet is fetched and listed in
// document.styleSheets like any other, and has no effect on screen.
// https://html.spec.whatwg.org/multipage/semantics.html#attr-style-media
// https://html.spec.whatwg.org/multipage/semantics.html#attr-link-media

function visibilityOf(window) {
  return window.getComputedStyle(window.document.body).visibility;
}

describe("Helpers: a style sheet's media attribute", () => {
  specify("a <style media=print> does not apply on screen", () => {
    const { window } = new JSDOM(`<style media="print">body { visibility: hidden }</style>`);

    assert.equal(window.document.styleSheets.length, 1);
    assert.equal(visibilityOf(window), "visible");
  });

  specify("a <style> whose media matches applies", () => {
    const { window } = new JSDOM(`<style media="screen and (min-width: 100px)">body { visibility: hidden }</style>`);

    assert.equal(visibilityOf(window), "hidden");
  });

  specify("a list of queries applies when any of them matches", () => {
    const { window } = new JSDOM(`<style media="print, screen">body { visibility: hidden }</style>`);

    assert.equal(visibilityOf(window), "hidden");
  });

  specify("changing the attribute changes whether the sheet applies", () => {
    const { window } = new JSDOM(`<style media="print">body { visibility: hidden }</style>`);
    const style = window.document.querySelector("style");

    assert.equal(visibilityOf(window), "visible");

    style.setAttribute("media", "all");
    assert.equal(visibilityOf(window), "hidden");

    style.removeAttribute("media");
    assert.equal(visibilityOf(window), "hidden");

    style.setAttribute("media", "print");
    assert.equal(visibilityOf(window), "visible");
  });

  specify("a <link media=print> does not apply on screen", async () => {
    const css = encodeURIComponent("body { visibility: hidden }");
    const { window } = new JSDOM(
      `<link rel="stylesheet" media="print" href="data:text/css,${css}">` +
      `<link rel="stylesheet" id="screen" href="data:text/css,${encodeURIComponent("body { color: red }")}">`,
      { resources: "usable" }
    );

    await new Promise(resolve => {
      window.document.getElementById("screen").addEventListener("load", resolve);
    });

    assert.equal(window.document.styleSheets.length, 2);
    assert.equal(window.getComputedStyle(window.document.body).color, "rgb(255, 0, 0)");
    assert.equal(visibilityOf(window), "visible");
  });
});
