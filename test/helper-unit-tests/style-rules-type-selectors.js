"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// The cascade indexes a rule under the rightmost simple selector of each branch
// of its selector list, and only the rules in the buckets an element could be
// in are ever matched against it. A branch ending in a type selector is keyed
// under the ASCII lowercased name; an element's local name is lowercase only
// where the HTML parser made it so. Every case below is a rule whose selector
// the selector engine agrees matches the element, so a value that does not
// arrive was dropped by the index rather than by matching.

/** The cascaded `width` of the element with id "t", given a sheet and a body. */
function widthOf(css, body) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><style>${css}</style></head><body>${body}</body></html>`
  );
  const element = dom.window.document.getElementById("t");
  const width = dom.window.getComputedStyle(element).getPropertyValue("width");

  dom.window.close();

  return width;
}

describe("Helpers: style-rules type selectors", () => {
  // A type selector whose name the HTML parser produced: lowercase on both
  // sides, which is the case that worked all along.
  specify("a lone type selector reaches an HTML element", () => {
    assert.equal(widthOf("section{width:42px}", "<section id=\"t\"></section>"), "42px");
  });

  specify("a lone type selector reaches a custom element", () => {
    assert.equal(widthOf("cg-container{width:42px}", "<cg-container id=\"t\"></cg-container>"), "42px");
  });

  specify("a type selector with a digit in it reaches its element", () => {
    assert.equal(widthOf("h2{width:42px}", "<h2 id=\"t\"></h2>"), "42px");
  });

  specify("a type selector in a selector list reaches its element", () => {
    assert.equal(widthOf("p,cg-x{width:42px}", "<cg-x id=\"t\"></cg-x>"), "42px");
  });

  specify("a type selector beside a class reaches its element", () => {
    assert.equal(widthOf("div.foo{width:42px}", "<div id=\"t\" class=\"foo\"></div>"), "42px");
  });

  specify("a type selector beside an id reaches its element", () => {
    assert.equal(widthOf("div#t{width:42px}", "<div id=\"t\"></div>"), "42px");
  });

  specify("a type selector beside an attribute predicate reaches its element", () => {
    assert.equal(widthOf("cg-x[data-a]{width:42px}", "<cg-x id=\"t\" data-a=\"1\"></cg-x>"), "42px");
  });

  specify("a type selector beside a pseudo-class reaches its element", () => {
    assert.equal(widthOf("cg-x:not(.y){width:42px}", "<cg-x id=\"t\"></cg-x>"), "42px");
  });

  specify("a type selector at the end of a descendant selector reaches its element", () => {
    assert.equal(widthOf("div cg-x{width:42px}", "<div><cg-x id=\"t\"></cg-x></div>"), "42px");
  });

  specify("a type selector after a child combinator written without spaces reaches its element", () => {
    assert.equal(widthOf("div>cg-x{width:42px}", "<div><cg-x id=\"t\"></cg-x></div>"), "42px");
  });

  specify("a type selector after an adjacent sibling combinator reaches its element", () => {
    assert.equal(widthOf("p+cg-x{width:42px}", "<p></p><cg-x id=\"t\"></cg-x>"), "42px");
  });

  specify("a type selector after a general sibling combinator reaches its element", () => {
    assert.equal(widthOf("p~cg-x{width:42px}", "<p></p><cg-x id=\"t\"></cg-x>"), "42px");
  });

  specify("a type selector inside :is() reaches its element", () => {
    assert.equal(widthOf(":is(cg-x,p){width:42px}", "<cg-x id=\"t\"></cg-x>"), "42px");
  });

  specify("a type selector in a list beside the universal selector reaches its element", () => {
    assert.equal(widthOf("*,cg-x{width:42px}", "<cg-x id=\"t\"></cg-x>"), "42px");
  });

  // An element the HTML parser did not name: SVG local names keep the case
  // they are defined with, and the index key is lowercased, so the two only
  // meet if the lookup lowercases too.
  specify("a lone type selector reaches an SVG element with a lowercase name", () => {
    assert.equal(widthOf("circle{width:42px}", "<svg><circle id=\"t\"/></svg>"), "42px");
  });

  specify("a lone type selector reaches clipPath", () => {
    assert.equal(widthOf("clipPath{width:42px}", "<svg><clipPath id=\"t\"/></svg>"), "42px");
  });

  specify("a lone type selector reaches linearGradient", () => {
    assert.equal(widthOf("linearGradient{width:42px}", "<svg><linearGradient id=\"t\"/></svg>"), "42px");
  });

  specify("a lone type selector reaches radialGradient", () => {
    assert.equal(widthOf("radialGradient{width:42px}", "<svg><radialGradient id=\"t\"/></svg>"), "42px");
  });

  specify("a lone type selector reaches feGaussianBlur", () => {
    assert.equal(
      widthOf("feGaussianBlur{width:42px}", "<svg><filter><feGaussianBlur id=\"t\"/></filter></svg>"),
      "42px"
    );
  });

  specify("a lone type selector reaches feColorMatrix", () => {
    assert.equal(
      widthOf("feColorMatrix{width:42px}", "<svg><filter><feColorMatrix id=\"t\"/></filter></svg>"),
      "42px"
    );
  });

  specify("a lone type selector reaches foreignObject", () => {
    assert.equal(widthOf("foreignObject{width:42px}", "<svg><foreignObject id=\"t\"/></svg>"), "42px");
  });

  specify("a lone type selector reaches textPath", () => {
    assert.equal(widthOf("textPath{width:42px}", "<svg><text><textPath id=\"t\"/></text></svg>"), "42px");
  });

  specify("a lone type selector reaches animateMotion", () => {
    assert.equal(widthOf("animateMotion{width:42px}", "<svg><animateMotion id=\"t\"/></svg>"), "42px");
  });

  specify("a mixed-case type selector in a selector list reaches its element", () => {
    assert.equal(widthOf("p,clipPath{width:42px}", "<svg><clipPath id=\"t\"/></svg>"), "42px");
  });

  specify("two mixed-case branches both reach their elements", () => {
    assert.equal(widthOf("clipPath,linearGradient{width:42px}", "<svg><linearGradient id=\"t\"/></svg>"), "42px");
  });

  specify("a mixed-case type selector at the end of a descendant selector reaches its element", () => {
    assert.equal(widthOf("svg clipPath{width:42px}", "<svg><clipPath id=\"t\"/></svg>"), "42px");
  });

  specify("a mixed-case type selector after a child combinator reaches its element", () => {
    assert.equal(widthOf("svg>clipPath{width:42px}", "<svg><clipPath id=\"t\"/></svg>"), "42px");
  });

  specify("a mixed-case type selector beside an id reaches its element", () => {
    assert.equal(widthOf("clipPath#t{width:42px}", "<svg><clipPath id=\"t\"/></svg>"), "42px");
  });

  specify("a mixed-case type selector beside an attribute predicate reaches its element", () => {
    assert.equal(widthOf("clipPath[data-a]{width:42px}", "<svg><clipPath id=\"t\" data-a=\"1\"/></svg>"), "42px");
  });

  specify("a mixed-case type selector inside a matching @media reaches its element", () => {
    assert.equal(widthOf("@media screen{clipPath{width:42px}}", "<svg><clipPath id=\"t\"/></svg>"), "42px");
  });

  // A mixed-case name on the ancestor side of a combinator, which the index
  // never keyed on and which therefore never broke; here so it stays that way.
  specify("a mixed-case type selector constraining an ancestor reaches the element it ends in", () => {
    assert.equal(widthOf("clipPath circle{width:42px}", "<svg><clipPath><circle id=\"t\"/></clipPath></svg>"), "42px");
  });

  specify("a mixed-case type selector constraining a sibling reaches the element it ends in", () => {
    assert.equal(widthOf("clipPath+circle{width:42px}", "<svg><clipPath/><circle id=\"t\"/></svg>"), "42px");
  });

  // The cascade over a rule the index now finds, which is the point of finding
  // it: it has to lose and win where a browser's does.
  specify("a mixed-case type selector loses to a later rule of equal specificity", () => {
    assert.equal(widthOf("clipPath{width:42px}clipPath{width:9px}", "<svg><clipPath id=\"t\"/></svg>"), "9px");
  });

  specify("a mixed-case type selector loses to a class selector", () => {
    assert.equal(widthOf("clipPath{width:42px}.c{width:9px}", "<svg><clipPath id=\"t\" class=\"c\"/></svg>"), "9px");
  });

  specify("a mixed-case type selector beats a later universal selector", () => {
    assert.equal(widthOf("*{width:9px}clipPath{width:42px}", "<svg><clipPath id=\"t\"/></svg>"), "42px");
  });

  // Lowercasing the lookup must not make the index less selective than it was:
  // a tag bucket an element is not in still has to stay out of its way.
  specify("a type selector naming another element does not reach this one", () => {
    assert.equal(widthOf("clipPath{width:42px}", "<svg><circle id=\"t\"/></svg>"), "");
  });

  specify("an HTML type selector naming another element does not reach this one", () => {
    assert.equal(widthOf("section{width:42px}", "<div id=\"t\"></div>"), "");
  });

  // The selector engine matches an ASCII uppercase type selector in
  // querySelector and not in matches, which is what the cascade asks. Until
  // that is one answer, a rule written "SECTION { … }" applies to nothing; the
  // index is not what loses it, and lowercasing the key is what keeps the two
  // from disagreeing a second time.
  specify("an uppercase type selector is lost by the selector engine, not the index", () => {
    const dom = new JSDOM("<!DOCTYPE html><body><section id=\"t\"></section>");
    const element = dom.window.document.getElementById("t");

    assert.equal(element.matches("SECTION"), false);
    assert.equal(dom.window.document.querySelector("SECTION"), element);

    dom.window.close();

    assert.equal(widthOf("SECTION{width:42px}", "<section id=\"t\"></section>"), "");
  });
});
