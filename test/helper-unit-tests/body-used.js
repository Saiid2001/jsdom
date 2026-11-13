"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// bodyUsed is a boolean: true once a body that exists has been read. A
// Response was built without the field and reported undefined, and reading a
// body that does not exist marked it used.
// https://fetch.spec.whatwg.org/#dom-body-bodyused

describe("Helpers: bodyUsed", () => {
  specify("is false before a body is read, and true after", async () => {
    const { window } = new JSDOM("", { url: "https://site.test/" });
    const response = new window.Response("text");

    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), "text");
    assert.equal(response.bodyUsed, true);
  });

  specify("stays false when there is no body to read", async () => {
    const { window } = new JSDOM("", { url: "https://site.test/" });
    const response = new window.Response(undefined);

    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), "");
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), "");
  });
});
