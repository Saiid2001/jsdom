"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");

// A loader that answers every request with a body and the status given, as a
// loader does that hands back whatever the server sent -- binb's tunnel among
// them -- rather than rejecting a response that is not ok, as jsdom's own
// loader does.
class StatusLoader extends ResourceLoader {
  constructor(statusFor) {
    super();
    this._statusFor = statusFor;
  }

  fetch(url) {
    const statusCode = this._statusFor(url);
    const request = Promise.resolve(Buffer.from("#t { color: rgb(255, 0, 0); }"));

    request.response = { statusCode, headers: { "content-type": "text/css" } };
    request.statusCode = statusCode;
    request.href = url;
    request.abort = () => {};
    request.getHeader = () => null;

    return request;
  }
}

/** The events a stylesheet link fires, and whether its rules applied. */
function loadSheet(html, statusFor) {
  return new Promise(resolve => {
    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body><p id="t"></p></body></html>`, {
      url: "http://example.test/",
      resources: new StatusLoader(statusFor),
      virtualConsole: new VirtualConsole()
    });
    const { document } = dom.window;
    const events = [];

    document.head.insertAdjacentHTML("beforeend", html);

    const element = document.head.lastElementChild;

    const finish = () => {
      const color = dom.window.getComputedStyle(document.getElementById("t")).color;

      dom.window.close();
      resolve({ events, applied: color === "rgb(255, 0, 0)" });
    };

    element.addEventListener("load", () => {
      events.push("load");
      finish();
    });
    element.addEventListener("error", () => {
      events.push("error");
      finish();
    });
  });
}

describe("Helpers: subresource status", () => {
  specify("a stylesheet answered 200 fires load and applies", async () => {
    const result = await loadSheet(`<link rel="stylesheet" href="/a.css">`, () => 200);

    assert.deepEqual(result, { events: ["load"], applied: true });
  });

  for (const status of [404, 503, 302, 100]) {
    specify(`a stylesheet answered ${status} fires error and does not apply`, async () => {
      const result = await loadSheet(`<link rel="stylesheet" href="/a.css">`, () => status);

      assert.deepEqual(result, { events: ["error"], applied: false });
    });
  }

  specify("an @import answered 404 fires error on the element that imports it", async () => {
    const result = await loadSheet(
      `<style>@import url(/missing.css);</style>`,
      url => (url.endsWith("/missing.css") ? 404 : 200)
    );

    assert.deepEqual(result.events, ["error"]);
  });
});
