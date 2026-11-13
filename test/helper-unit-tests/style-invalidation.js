"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, computedStyle } = require("../../lib/api.js");
const { implForWrapper } = require("../../lib/jsdom/living/generated/utils.js");
const { getDeclarationForElement } = require("../../lib/jsdom/living/helpers/style-rules.js");

// A change to the document throws away the styles it can affect and keeps the
// rest. Every change used to throw away all of them, so a page that set an
// attribute no selector reads -- an image finishing its load, aria-expanded --
// had its whole cascade run again at the next read.

const RED = "rgb(255, 0, 0)";

function page(html) {
  const { window } = new JSDOM(html);
  const { document } = window;

  return {
    window,
    document,
    color: id => window.getComputedStyle(document.getElementById(id)).color,
    declaration: id => getDeclarationForElement(implForWrapper(document.getElementById(id)))
  };
}

describe("Helpers: style invalidation", () => {
  specify("an attribute no selector reads keeps the styles already resolved", () => {
    const { document, declaration } = page(`<style>.a p { color: red } [data-on] { color: blue }</style>
      <div class="a" id="w"><p id="x">t</p></div>`);
    const before = declaration("x");

    document.getElementById("w").setAttribute("aria-expanded", "true");
    document.getElementById("x").setAttribute("data-k", "1");

    assert.equal(declaration("x"), before);
  });

  specify("a class no selector names keeps the styles already resolved", () => {
    const { document, declaration } = page(`<style>.a p { color: red }</style>
      <div class="a" id="w"><p id="x">t</p></div>`);
    const before = declaration("x");

    document.getElementById("w").classList.add("unstyled");
    document.body.classList.add("also-unstyled");

    assert.equal(declaration("x"), before);
  });

  specify("an attribute a selector reads is seen, on the element and below it", () => {
    const { document, color } = page(`<style>[data-on] p { color: red } p[data-on] { color: red }</style>
      <div id="w"><p id="x">t</p><p id="y">t</p></div>`);

    assert.notEqual(color("x"), RED);
    document.getElementById("w").setAttribute("data-on", "");
    assert.equal(color("x"), RED);

    document.getElementById("w").removeAttribute("data-on");
    assert.notEqual(color("y"), RED);
    document.getElementById("y").setAttribute("data-on", "");
    assert.equal(color("y"), RED);
  });

  specify("a class or an id a selector names is seen, on the element and below it", () => {
    const { document, color } = page(`<style>.on > p { color: red } #hot p { color: red } .lit { color: red }</style>
      <div id="w"><p id="x">t</p></div><div id="v"><p id="y">t</p></div><p id="z">t</p>`);

    document.getElementById("w").className = "on";
    assert.equal(color("x"), RED);
    document.getElementById("w").className = "";
    assert.notEqual(color("x"), RED);

    document.getElementById("v").id = "hot";
    assert.equal(color("y"), RED);

    document.getElementById("z").classList.add("lit");
    assert.equal(color("z"), RED);
  });

  specify("a change before a sibling combinator is seen by the siblings after it", () => {
    const { document, color } = page(`<style>.a + p { color: red } .b ~ div p { color: red }</style>
      <div><i id="i"></i><p id="x">t</p></div>
      <div><i id="j"></i><span></span><div><p id="y">t</p></div></div>`);

    document.getElementById("i").className = "a";
    assert.equal(color("x"), RED);

    document.getElementById("j").className = "b";
    assert.equal(color("y"), RED);
  });

  specify("an inherited value follows the ancestor it comes from", () => {
    const { document, color } = page(`<style>.on { color: red }</style>
      <div id="w"><section><p id="x">t</p></section></div>`);

    color("x");
    document.getElementById("w").className = "on";
    assert.equal(color("x"), RED);

    document.getElementById("w").className = "";
    document.getElementById("w").style.color = "red";
    assert.equal(color("x"), RED);
  });

  specify("a declared inherit and a custom property follow the ancestor", () => {
    const { document, color } = page(`<style>.on { --c: red; border-top-color: red } i { color: var(--c, blue) }
      b { border-top-color: inherit }</style>
      <div id="w"><i id="x">t</i><b id="y">t</b></div>`);

    function b() {
      return document.defaultView.getComputedStyle(document.getElementById("y")).borderTopColor;
    }

    color("x");
    b();
    document.getElementById("w").className = "on";
    assert.equal(color("x"), RED);
    assert.equal(b(), RED);
  });

  specify("a child added or removed is seen by structural and sibling selectors", () => {
    const { document, color } = page(`<style>p:first-child { color: red } ul > li:last-child { color: red }
      .k + p { color: red }</style>
      <div id="w"><p id="x">t</p></div><ul id="u"><li id="l">t</li></ul><div id="v"><p id="y">t</p></div>`);

    assert.equal(color("x"), RED);
    document.getElementById("w").prepend(document.createElement("span"));
    assert.notEqual(color("x"), RED);

    assert.equal(color("l"), RED);
    document.getElementById("u").append(document.createElement("li"));
    assert.notEqual(color("l"), RED);

    const k = document.createElement("i");
    k.className = "k";
    document.getElementById("v").prepend(k);
    assert.equal(color("y"), RED);
  });

  specify("a subtree moved under a different ancestor is styled for where it is now", () => {
    const { document, color } = page(`<style>.on p { color: red }</style>
      <div id="w"><p id="x">t</p></div><div class="on" id="v"></div>`);

    assert.notEqual(color("x"), RED);
    document.getElementById("v").append(document.getElementById("x"));
    assert.equal(color("x"), RED);
  });

  specify("a presentational hint and a stylesheet added are seen", () => {
    const { document, window } = page(`<table><tr><td id="c">t</td></tr></table><p id="x">t</p>`);
    const cell = document.getElementById("c");

    assert.notEqual(window.getComputedStyle(cell).verticalAlign, "top");
    cell.setAttribute("valign", "top");
    assert.equal(window.getComputedStyle(cell).verticalAlign, "top");

    assert.notEqual(window.getComputedStyle(document.getElementById("x")).color, RED);
    const style = document.createElement("style");
    style.textContent = "p { color: red }";
    document.head.append(style);
    assert.equal(window.getComputedStyle(document.getElementById("x")).color, RED);

    style.remove();
    assert.notEqual(window.getComputedStyle(document.getElementById("x")).color, RED);
  });

  specify("a selector the features cannot read invalidates as before", () => {
    const { document, color } = page(`<style>div:has(> .on) p { color: red } .a\\:b p { color: red }</style>
      <div id="w"><i id="i"></i><p id="x">t</p></div><div id="v"><p id="y">t</p></div>`);

    document.getElementById("i").className = "on";
    assert.equal(color("x"), RED);

    document.getElementById("v").className = "a:b";
    assert.equal(color("y"), RED);
  });

  specify("a :has() follows children added and removed below and beside it", () => {
    const { document, color } = page(`<style>section:has(.flag) p { color: red } ul:has(> li.x) { color: red }
      h2:has(+ .note) { color: red }</style>
      <section id="s"><div><div id="deep"></div></div><p id="x">t</p></section>
      <ul id="u"><li>t</li></ul><div><h2 id="h">t</h2></div>`);

    assert.notEqual(color("x"), RED);
    const flag = document.createElement("i");
    flag.className = "flag";
    document.getElementById("deep").append(flag);
    assert.equal(color("x"), RED);
    flag.remove();
    assert.notEqual(color("x"), RED);

    assert.notEqual(color("u"), RED);
    const li = document.createElement("li");
    li.className = "x";
    document.getElementById("u").append(li);
    assert.equal(color("u"), RED);

    assert.notEqual(color("h"), RED);
    const note = document.createElement("p");
    note.className = "note";
    document.getElementById("h").after(note);
    assert.equal(color("h"), RED);
    note.remove();
    assert.notEqual(color("h"), RED);
  });

  specify("the computed style a layout reads is kept while nothing it is computed from changes", () => {
    const { document } = page(`<style>.on { color: red } span { text-decoration: underline }</style>
      <div id="w"><p><span id="a">t</span> <span id="b">t</span></p></div>`);
    const a = document.getElementById("a");
    const before = computedStyle(a);

    // Siblings computed from the same declaration share it.
    assert.equal(computedStyle(document.getElementById("b")), before);

    document.getElementById("w").setAttribute("aria-hidden", "false");
    assert.equal(computedStyle(a), before);

    document.getElementById("w").className = "on";
    assert.notEqual(computedStyle(a), before);
    assert.equal(computedStyle(a).color, RED);
  });

  specify("a :has() reading above or across itself through :is() follows changes there", () => {
    const { document, color } = page(`<style>.red:has(#d:is(.a .b)) { color: red }
      .green:has(#e:is(.p + .c ~ .q .r)) { color: red }</style>
      <div id="top"><div id="s" class="red"><i id="d" class="b"></i></div></div>
      <div><i class="p"></i><i id="prev"></i><div class="q"><div id="t" class="green"><i id="e" class="r"></i></div></div></div>`);

    assert.notEqual(color("s"), RED);
    document.getElementById("top").classList.add("a");
    assert.equal(color("s"), RED);

    assert.notEqual(color("t"), RED);
    document.getElementById("prev").classList.add("c");
    assert.equal(color("t"), RED);

    // An element carrying nothing the selector names still parts .p from .c.
    document.getElementById("prev").before(document.createElement("b"));
    assert.notEqual(color("t"), RED);
  });
});
