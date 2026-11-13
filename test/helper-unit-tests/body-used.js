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

describe("Helpers: the body a Response is constructed with", () => {
  specify("URLSearchParams is sent form-encoded", async () => {
    const { window } = new JSDOM("", { url: "https://site.test/" });
    const response = new window.Response(new window.URLSearchParams("a=1&b=2"));

    assert.equal(response.headers.get("content-type"), "application/x-www-form-urlencoded;charset=UTF-8");
    assert.equal(await response.text(), "a=1&b=2");
  });

  specify("a ReadableStream is read, and a chunk that is not a Uint8Array is a TypeError", async () => {
    const { window } = new JSDOM("", { url: "https://site.test/" });
    const { ReadableStream } = require("node:stream/web");
    const good = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("he"));
        controller.enqueue(new TextEncoder().encode("llo"));
        controller.close();
      }
    });
    const bad = new ReadableStream({
      start(controller) {
        controller.enqueue("not bytes");
        controller.close();
      }
    });

    const response = new window.Response(good);

    assert.equal(response.headers.get("content-type"), null);
    assert.equal(await response.text(), "hello");
    await assert.rejects(new window.Response(bad).text(), TypeError);
  });
});
