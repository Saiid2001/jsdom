"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");

// This fork submits a form by dispatching a `navigate` event on the document
// for the host to load, where jsdom submits nothing. The form submission
// algorithm around it decides whether that event is dispatched at all.
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-algorithm

/** A document holding `body`, and the URLs it asked to navigate to. */
function page(body) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: "http://example.test/page.html",
    virtualConsole: new VirtualConsole()
  });
  const navigations = [];

  window.document.addEventListener("navigate", event => navigations.push(event.detail.url));

  return { window, document: window.document, navigations };
}

describe("Helpers: form submission", () => {
  specify("a submission whose submit event was canceled does not stop the next one", () => {
    const { document } = page(`<form><button type="submit"></button></form>`);
    const form = document.querySelector("form");
    let submits = 0;

    form.addEventListener("submit", event => {
      submits++;
      event.preventDefault();
    });

    form.requestSubmit();
    form.requestSubmit();
    document.querySelector("button").click();

    assert.equal(submits, 3);
  });

  specify("requestSubmit() from inside its own submit event is not run again", () => {
    const { document } = page(`<form><input type="submit"></form>`);
    const form = document.querySelector("form");
    let submits = 0;

    form.addEventListener("submit", event => {
      submits++;
      form.requestSubmit();
      document.querySelector("input").click();
      event.preventDefault();
    });

    form.requestSubmit();

    assert.equal(submits, 1);
  });

  specify("submit() fires no submit event and does not validate, and navigates", () => {
    const { document, navigations } = page(`<form action="/next"><input name="q" value="x" required></form>`);
    const form = document.querySelector("form");
    let events = 0;

    form.addEventListener("submit", () => events++);
    document.querySelector("input").addEventListener("invalid", () => events++);
    document.querySelector("input").value = "";

    form.submit();

    assert.equal(events, 0);
    assert.deepEqual(navigations, ["http://example.test/next?q="]);
  });

  specify("a disconnected form submits nothing and throws nothing", () => {
    const { document, navigations } = page(``);
    const form = document.createElement("form");
    let submits = 0;

    form.addEventListener("submit", event => {
      submits++;
      event.preventDefault();
    });

    form.submit();
    form.requestSubmit();

    assert.equal(submits, 0);
    assert.deepEqual(navigations, []);
  });

  specify("a form taken out of the document by its submit event does not navigate", () => {
    const { document, navigations } = page(`<form action="/next"><input type="submit"></form>`);
    const form = document.querySelector("form");

    form.addEventListener("submit", () => form.remove());
    document.querySelector("input").click();

    assert.deepEqual(navigations, []);
  });

  specify("a submitter with formnovalidate skips validation", () => {
    const { document, navigations } = page(
      `<form action="/next"><input name="q" required><button formnovalidate></button></form>`
    );

    document.querySelector("button").click();

    assert.deepEqual(navigations, ["http://example.test/next?q="]);
  });

  specify("a target naming a frame in the document does not navigate this document", () => {
    const { document, navigations } = page(
      `<iframe name="sink"></iframe><form action="/next" target="sink"><input type="submit"></form>` +
      `<form id="two" action="/next"><button formtarget="sink"></button></form>`
    );

    document.querySelector("input").click();
    document.querySelector("#two button").click();

    assert.deepEqual(navigations, []);
  });

  for (const target of ["", "_self", "_top", "_parent", "_SELF"]) {
    specify(`a target of "${target}" navigates this document`, () => {
      const { document, navigations } = page(`<form action="/next" target="${target}"><input type="submit"></form>`);

      document.querySelector("input").click();

      assert.deepEqual(navigations, ["http://example.test/next"]);
    });
  }
});
