"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { svgIntrinsicSize } = require("../../lib/jsdom/living/helpers/svg-intrinsic-size.js");

// An SVG image's natural size is its root element's width and height, in
// pixels, and failing those its viewBox's. Page builders size a box with a
// transparent placeholder written as `<svg width='2321' height='345'>` in a data
// URL; read as 100x100, the box it was there to size was a sliver.
// https://svgwg.org/svg2-draft/coords.html#SizingSVGInCSS

describe("Helpers: an SVG image's intrinsic size", () => {
  specify("the root's width and height, in either quotes", () => {
    assert.deepEqual(svgIntrinsicSize(`<svg xmlns='http://www.w3.org/2000/svg' width='2321' height='345' viewBox='0 0 10 10'>`),
      { width: 2321, height: 345 });
    assert.deepEqual(svgIntrinsicSize(`<svg width="24px" height="12.5px">`), { width: 24, height: 12.5 });
  });

  specify("the viewBox where there is no width or height, separated by commas or runs of spaces", () => {
    assert.deepEqual(svgIntrinsicSize(`<?xml version="1.0"?><svg viewBox="0,0,196,132">`), { width: 196, height: 132 });
    assert.deepEqual(svgIntrinsicSize(`<svg viewBox='0  0   40 20'>`), { width: 40, height: 20 });
  });

  specify("a percentage width is not a size; the viewBox keeps the ratio", () => {
    assert.deepEqual(svgIntrinsicSize(`<svg width="100%" height="50" viewBox="0 0 200 100">`), { width: 100, height: 50 });
  });

  specify("only the root element is read", () => {
    assert.deepEqual(svgIntrinsicSize(`<svg viewBox="0 0 30 30"><rect width="5" height="5"/></svg>`), { width: 30, height: 30 });
  });

  specify("nothing to go on", () => {
    assert.equal(svgIntrinsicSize(`<svg>`), null);
  });
});
