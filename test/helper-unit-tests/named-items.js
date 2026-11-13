"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A document's named items and a form's named controls, read as properties:
// `document.popClock.pop.value = ...` is how a page of the late nineties
// writes into its form, and churchofeuthanasia.org's population clock threw on
// it. Built-in properties are not shadowed, where the specification says a
// document and a form override them: an <input name="submit"> hiding the
// form's submit() is the best known way that breaks pages.
// https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem
// https://html.spec.whatwg.org/multipage/forms.html#the-form-element

function page(body) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`);
  return { window, document: window.document };
}

describe("Helpers: named items on a document and a form", () => {
  specify("a named form, and a named control on it", () => {
    const { document } = page(`<form name="popClock"><input name="pop"></form>`);

    assert.equal(document.popClock, document.querySelector("form"));
    assert.equal(document.popClock.pop, document.querySelector("input"));
  });

  specify("an image and an iframe by name; the iframe as its window", () => {
    const { document } = page(`<img name="logo"><iframe name="frame"></iframe>`);

    assert.equal(document.logo, document.querySelector("img"));
    assert.equal(document.frame, document.querySelector("iframe").contentWindow);
  });

  specify("several items of one name are a collection", () => {
    const { document } = page(`<form name="f"></form><form name="f"></form>`);

    assert.equal(document.f.length, 2);
  });

  specify("radio buttons of one name on a form are a list with a value", () => {
    const { document } = page(`<form><input type="radio" name="r" value="a"><input type="radio" name="r" value="b" checked></form>`);

    assert.equal(document.forms[0].r.value, "b");
  });

  specify("a control by id, and a name added or removed later", () => {
    const { document } = page(`<form name="f"><input id="field"></form>`);
    const form = document.f;

    assert.equal(form.field, document.querySelector("input"));

    const select = document.createElement("select");
    select.setAttribute("name", "choice");
    form.appendChild(select);
    assert.equal(form.choice, select);

    select.remove();
    assert.equal(form.choice, undefined);
  });

  specify("a div by name is not a document's named item", () => {
    const { document } = page(`<div name="nothing"></div>`);

    assert.equal(document.nothing, undefined);
  });

  specify("built-in properties are not shadowed", () => {
    const { document } = page(`<form name="title"><input name="submit"><input name="action"></form>`);

    assert.equal(typeof document.title, "string");
    assert.equal(typeof document.forms[0].submit, "function");
  });
});
