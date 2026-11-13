"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// A Response a page constructs reads back the body it was given. The
// constructor took its body for one already extracted and found none in it, so
// `new Response(blob).arrayBuffer()` -- a common way to read a Blob -- and
// every other constructed response read back empty.
// https://fetch.spec.whatwg.org/#dom-response
//
// Response.clone() called a constructor that does not exist and threw, so a
// page that clones a response -- to read a body twice, or to hand one copy to
// a cache -- lost both. A clone has the original's status, headers, URL and
// body, and each can be read on its own.

describe("Helpers: a constructed Response's body", () => {
  specify("a string, JSON text, bytes and a Blob read back as given", async () => {
    const { window } = new JSDOM("", { url: "https://example.com/" });

    assert.equal(await new window.Response("hello").text(), "hello");
    assert.deepEqual(await new window.Response(JSON.stringify({ a: 1 })).json(), { a: 1 });
    assert.equal(await new window.Response(new window.Uint8Array([104, 105])).text(), "hi");
    assert.equal(await new window.Response(new window.Blob(["from a blob"])).text(), "from a blob");
  });

  specify("the body's type becomes the content type where none is given", () => {
    const { window } = new JSDOM("", { url: "https://example.com/" });

    assert.equal(new window.Response("x").headers.get("content-type"), "text/plain;charset=UTF-8");
    assert.equal(new window.Response(new window.Blob(["x"], { type: "image/png" })).headers.get("content-type"), "image/png");
  });

  specify("URLSearchParams is sent serialized", async () => {
    const { window } = new JSDOM("", { url: "https://example.com/" });

    assert.equal(await new window.Response(new window.URLSearchParams("a=1&b=2")).text(), "a=1&b=2");
  });
});

describe("Helpers: Response.clone()", () => {
  specify("a constructed response clones with its body, status and headers", async () => {
    const { window } = new JSDOM("", { url: "https://example.com/" });
    const response = new window.Response("hello", { status: 201, headers: { "X-Kind": "greeting" } });
    const copy = response.clone();

    assert.equal(copy.status, 201);
    assert.equal(copy.headers.get("x-kind"), "greeting");
    assert.equal(await copy.text(), "hello");
    assert.equal(await response.text(), "hello");
  });

  specify("a fetched response clones with its URL", async () => {
    const server = await createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("fetched");
    });
    const url = `http://127.0.0.1:${server.address().port}/`;
    const { window } = new JSDOM("", { url, virtualConsole: new VirtualConsole() });

    try {
      const response = await window.fetch(url);
      const copy = response.clone();

      assert.equal(copy.url, response.url);
      assert.equal(await copy.text(), "fetched");
      assert.equal(await response.text(), "fetched");
    } finally {
      window.close();
      server.destroy();
    }
  });
});
