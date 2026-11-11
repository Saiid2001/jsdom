"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// An event handler content attribute is kept whatever document the element is
// in, and compiled when its event fires. An element made in a document that
// runs no scripts -- a template's contents, a DOMParser document -- carries its
// handlers into the document it is adopted into, and they run there.
describe("Helpers: event handler attributes across documents", () => {
  const { window } = new JSDOM(`<template><form onsubmit="return false"><button onclick="this.dataset.hit = 'yes'"></button></form></template>`, {
    runScripts: "dangerously"
  });
  const { document } = window;

  specify("a handler written in a template runs once its clone is in the document", () => {
    const form = document.querySelector("template").content.firstChild.cloneNode(true);

    document.body.appendChild(form);

    const submit = new window.Event("submit", { cancelable: true });

    form.dispatchEvent(submit);
    assert.equal(submit.defaultPrevented, true);

    form.querySelector("button").dispatchEvent(new window.Event("click"));
    assert.equal(form.querySelector("button").dataset.hit, "yes");
  });

  specify("the IDL attribute reads the handler once adopted", () => {
    const form = document.querySelector("template").content.firstChild.cloneNode(true);

    document.body.appendChild(form);

    assert.equal(typeof form.onsubmit, "function");
  });

  specify("a handler in a document that runs no scripts does not run", () => {
    const parsed = new window.DOMParser().parseFromString(`<button onclick="this.dataset.hit = 'yes'"></button>`, "text/html");
    const button = parsed.querySelector("button");

    button.dispatchEvent(new window.Event("click"));

    assert.equal(button.dataset.hit, undefined);
    assert.equal(button.onclick, null);
  });

  specify("nor does one in a document without scripts at all", () => {
    const other = new JSDOM(`<button onclick="this.dataset.hit = 'yes'"></button>`).window.document;
    const button = other.querySelector("button");

    button.dispatchEvent(new other.defaultView.Event("click"));

    assert.equal(button.dataset.hit, undefined);
  });
});
