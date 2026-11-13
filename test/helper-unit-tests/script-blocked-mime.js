"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");

// A script served as audio, image, video or text/csv is never run.
// https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-mime-type?

class TypedLoader extends ResourceLoader {
  fetch(url) {
    const type = new URL(url).searchParams.get("type");
    const request = Promise.resolve(Buffer.from(""));

    request.response = { statusCode: 200, headers: { "content-type": type } };
    request.statusCode = 200;
    request.href = url;
    request.abort = () => {};
    request.getHeader = () => null;

    return request;
  }
}

function load(type) {
  return new Promise(resolve => {
    const { window } = new JSDOM("<!DOCTYPE html><body></body>", {
      url: "https://site.test/",
      runScripts: "dangerously",
      resources: new TypedLoader(),
      virtualConsole: new VirtualConsole()
    });
    const script = window.document.createElement("script");

    script.onload = () => resolve("load");
    script.onerror = () => resolve("error");
    script.src = `/s.js?type=${encodeURIComponent(type)}`;
    window.document.body.appendChild(script);
  });
}

describe("Helpers: a script blocked by its MIME type", () => {
  for (const type of ["image/jpeg", "audio/midi", "video/avi", "text/csv"]) {
    specify(`${type} is not run`, async () => {
      assert.equal(await load(type), "error");
    });
  }

  specify("text/plain is run", async () => {
    assert.equal(await load("text/plain"), "load");
  });
});
