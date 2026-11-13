"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A document's style sheets are in the tree order of the elements that own
// them, which is also their order in the cascade -- not the order they arrived
// in. A linked sheet arrives once it is fetched, after every <style> parsed in
// the meantime, and appended then it beat the inline rules written after it to
// override it: a Joomla template's `#sp-header { height: 10% }`, in a <style>
// following the template's sheet, lost to the sheet's `height: 70px`, and the
// header was cut to 70px with its menu laid over the page beneath.
// https://drafts.csswg.org/cssom/#documentorshadowroot-document-or-shadow-root-css-style-sheets

const sheetURL = css => `data:text/css,${encodeURIComponent(css)}`;

function loaded(dom) {
  return new Promise(resolve => {
    dom.window.addEventListener("load", () => resolve(dom.window));
  });
}

describe("Helpers: style sheet order", () => {
  specify("a linked sheet loses to a <style> after it, though it arrives later", async () => {
    const window = await loaded(new JSDOM(`
      <link rel="stylesheet" href="${sheetURL("#x { height: 70px }")}">
      <style>#x { height: 10px }</style>
      <div id="x"></div>`, { resources: "usable" }));

    assert.equal(window.getComputedStyle(window.document.getElementById("x")).height, "10px");
  });

  specify("document.styleSheets lists sheets by their owners' tree order", async () => {
    const window = await loaded(new JSDOM(`
      <style id="a"></style>
      <link id="b" rel="stylesheet" href="${sheetURL("p {}")}">
      <style id="c"></style>`, { resources: "usable" }));
    const owners = [...window.document.styleSheets].map(sheet => sheet._ownerElement.getAttributeNS(null, "id"));

    assert.deepEqual(owners, ["a", "b", "c"]);
  });

  specify("a <style> added by script goes where it is inserted", () => {
    const { window } = new JSDOM(`<style id="a">#x { color: red }</style><div id="x"></div>`);
    const early = window.document.createElement("style");

    early.textContent = "#x { color: blue }";
    window.document.head.prepend(early);

    assert.equal(window.getComputedStyle(window.document.getElementById("x")).color, "rgb(255, 0, 0)");
  });
});
