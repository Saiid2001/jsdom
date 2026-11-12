"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");

// This fork follows a link by dispatching a `navigate` event on the document
// for the host to load. An <a> or <area> with no href is not a hyperlink, and
// activating one goes nowhere: a script-driven "Got it" button written as a
// bare <a> sent the page to its base URL.
// https://html.spec.whatwg.org/multipage/links.html#links-created-by-a-and-area-elements

function page(body) {
  const { window } = new JSDOM(`<!DOCTYPE html><head><base href="http://example.test/"></head><body>${body}</body>`, {
    url: "http://example.test/section/page.html",
    virtualConsole: new VirtualConsole()
  });
  const navigations = [];

  window.document.addEventListener("navigate", event => navigations.push(String(event.detail.url)));

  return { window, document: window.document, navigations };
}

const settle = window => new Promise(resolve => window.setTimeout(resolve, 10));

describe("Helpers: hyperlink activation", () => {
  specify("an <a> with no href is not followed", async () => {
    const { window, document, navigations } = page(`<a>Got it</a>`);

    document.querySelector("a").click();
    await settle(window);

    assert.deepEqual(navigations, []);
  });

  specify("an <area> with no href is not followed", async () => {
    const { window, document, navigations } = page(`<map name="m"><area shape="default"></map>`);

    document.querySelector("area").click();
    await settle(window);

    assert.deepEqual(navigations, []);
  });

  specify("an <a> with an href is followed", async () => {
    const { window, document, navigations } = page(`<a href="next.html">Next</a>`);

    document.querySelector("a").click();
    await settle(window);

    assert.deepEqual(navigations, ["http://example.test/next.html"]);
  });
});
