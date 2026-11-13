"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// The attributes HTML maps to CSS properties as presentational hints: author
// declarations ranked below every author rule. A page laid out with tables
// sizes its columns with them; without them churchofeuthanasia.org's 200px
// sidebar cell took the whole width and pushed the content off the page.
// https://html.spec.whatwg.org/multipage/rendering.html#tables-2

function styleOf(html, selector) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  return window.getComputedStyle(window.document.querySelector(selector));
}

describe("Helpers: presentational hints", () => {
  specify("a cell's width and height", () => {
    const style = styleOf(`<table><tr><td width="200" height="30">x</td></tr></table>`, "td");

    assert.equal(style.width, "200px");
    assert.equal(style.height, "30px");
  });

  specify("a percentage stays one, and zero is no width", () => {
    assert.equal(styleOf(`<table width="100%"><tr><td>x</td></tr></table>`, "table").width, "100%");
    assert.equal(styleOf(`<table><tr><td width="0">x</td></tr></table>`, "td").width, "");
  });

  specify("an author rule, even of no specificity, wins over a hint", () => {
    assert.equal(styleOf(`<style>* { width: 50px }</style><table><tr><td width="200">x</td></tr></table>`, "td").width, "50px");
  });

  specify("bgcolor, in the legacy forms", () => {
    assert.equal(styleOf(`<table bgcolor="#ff0000"><tr><td>x</td></tr></table>`, "table").backgroundColor, "rgb(255, 0, 0)");
    assert.equal(styleOf(`<table><tr><td bgcolor="00ff00">x</td></tr></table>`, "td").backgroundColor, "rgb(0, 255, 0)");
    assert.equal(styleOf(`<table><tr bgcolor="navy"><td>x</td></tr></table>`, "tr").backgroundColor, "rgb(0, 0, 128)");
  });

  specify("align and valign on cells and rows", () => {
    const cell = styleOf(`<table><tr><td align="center" valign="top">x</td></tr></table>`, "td");

    assert.equal(cell.textAlign, "center");
    assert.equal(cell.verticalAlign, "top");
    assert.equal(styleOf(`<table><tr align="right"><td>x</td></tr></table>`, "tr").textAlign, "right");
  });

  specify("a centred table has automatic side margins, and an aligned one floats", () => {
    const centred = styleOf(`<table align="center"><tr><td>x</td></tr></table>`, "table");

    assert.equal(centred.marginLeft, "auto");
    assert.equal(centred.marginRight, "auto");
    assert.equal(styleOf(`<table align="left"><tr><td>x</td></tr></table>`, "table").cssFloat, "left");
  });

  specify("a hint changed later is seen", () => {
    const { window } = new JSDOM(`<!DOCTYPE html><table><tr><td width="200">x</td></tr></table>`);
    const cell = window.document.querySelector("td");

    assert.equal(window.getComputedStyle(cell).width, "200px");
    cell.setAttribute("width", "120");
    assert.equal(window.getComputedStyle(cell).width, "120px");
  });
});
