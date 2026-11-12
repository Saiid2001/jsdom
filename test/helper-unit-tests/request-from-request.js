"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A Request made from another Request carries its headers, which is what
// fetch(request) does with its input. The headers were read as a record of the
// Headers object's own fields, and building one threw.
// https://fetch.spec.whatwg.org/#dom-request

function page() {
  return new JSDOM("", { url: "https://example.test/" }).window;
}

describe("Helpers: a Request made from a Request", () => {
  specify("keeps the headers of the request it was made from", () => {
    const window = page();
    const original = new window.Request("/a", { headers: { "X-One": "1", "Accept": "text/plain" } });
    const copy = new window.Request(original);

    assert.equal(copy.url, "https://example.test/a");
    assert.equal(copy.headers.get("x-one"), "1");
    assert.equal(copy.headers.get("accept"), "text/plain");
  });

  specify("a Headers object is a valid init for another", () => {
    const window = page();
    const headers = new window.Headers(new window.Headers({ "X-Two": "2" }));

    assert.equal(headers.get("x-two"), "2");
  });
});
