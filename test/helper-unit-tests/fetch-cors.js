"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// fetch's response tainting and CORS protocol
// (https://fetch.spec.whatwg.org/#main-fetch, #cors-check, #cors-preflight-fetch).
// Every fetch came back as a "default" response with the site's status and
// headers, whatever its mode and origin: a cross-origin response the site had
// not shared was handed to the page whole, and no preflight was ever made.

/** A proxy answering as the site in BSBX-PROXY-HOST, by what the path asks. */
async function site() {
  const seen = [];
  const server = await createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });

    const url = new URL(req.url, "http://x");
    const headers = {
      "Content-Type": "text/plain",
      "X-Secret": "s",
      "X-Shown": "v",
      "BSBX-PROXY-HOST": req.headers["bsbx-proxy-host"]
    };

    if (url.searchParams.has("allow")) {
      headers["Access-Control-Allow-Origin"] = url.searchParams.get("allow") || req.headers.origin;
    }
    if (url.searchParams.has("credentials")) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }
    if (url.searchParams.has("expose")) {
      headers["Access-Control-Expose-Headers"] = url.searchParams.get("expose");
    }
    if (req.method === "OPTIONS") {
      if (url.searchParams.has("methods")) {
        headers["Access-Control-Allow-Methods"] = url.searchParams.get("methods");
      }
      if (url.searchParams.has("headers")) {
        headers["Access-Control-Allow-Headers"] = url.searchParams.get("headers");
      }
      res.writeHead(url.searchParams.has("preflightStatus") ? Number(url.searchParams.get("preflightStatus")) : 200, headers);
      res.end();
      return;
    }

    headers["Set-Cookie"] = "c=1; Path=/";
    res.writeHead(200, headers);
    res.end("body");
  });

  class Loader extends ResourceLoader {
    constructor() {
      super();
      this.proxyUrl = `http://127.0.0.1:${server.address().port}/proxy`;
    }
  }

  const { window } = new JSDOM("", {
    url: "https://site.test/page",
    resources: new Loader(),
    virtualConsole: new VirtualConsole()
  });

  return { window, seen, done: () => { window.close(); server.destroy(); } };
}

describe("Helpers: fetch's CORS protocol", () => {
  specify("a same-origin response is basic, without its Set-Cookie", async () => {
    const { window, done } = await site();
    try {
      const response = await window.fetch("https://site.test/data");
      assert.equal(response.type, "basic");
      assert.equal(response.headers.get("x-secret"), "s");
      assert.equal(response.headers.get("set-cookie"), null);
    } finally {
      done();
    }
  });

  specify("a cross-origin no-cors response is opaque", async () => {
    const { window, done } = await site();
    try {
      const response = await window.fetch("https://other.test/data", { mode: "no-cors" });
      assert.equal(response.type, "opaque");
      assert.equal(response.status, 0);
      assert.equal(response.statusText, "");
      assert.equal([...response.headers].length, 0);
      assert.equal(await response.text(), "");
    } finally {
      done();
    }
  });

  specify("a cross-origin response the site does not share is a network error", async () => {
    const { window, done } = await site();
    try {
      await assert.rejects(window.fetch("https://other.test/data"), error => error instanceof window.TypeError);
    } finally {
      done();
    }
  });

  specify("a cross-origin response the site shares is cors, with only the headers it exposes", async () => {
    const { window, seen, done } = await site();
    try {
      const response = await window.fetch("https://other.test/data?allow&expose=x-shown");
      assert.equal(response.type, "cors");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/plain");
      assert.equal(response.headers.get("x-shown"), "v");
      assert.equal(response.headers.get("x-secret"), null);
      assert.equal(await response.text(), "body");
      assert.equal(seen[0].headers.origin, "https://site.test");
    } finally {
      done();
    }
  });

  specify("credentials are refused a wildcard", async () => {
    const { window, done } = await site();
    try {
      await assert.rejects(window.fetch("https://other.test/data?allow=*", { credentials: "include" }));
      const shared = await window.fetch("https://other.test/data?allow&credentials", { credentials: "include" });
      assert.equal(shared.type, "cors");
    } finally {
      done();
    }
  });

  specify("a request that is not simple is preflighted, and refused when the site does not allow it", async () => {
    const { window, seen, done } = await site();
    try {
      await assert.rejects(window.fetch("https://other.test/data?allow", { method: "PUT" }));
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, "OPTIONS");
      assert.equal(seen[0].headers["access-control-request-method"], "PUT");
    } finally {
      done();
    }
  });

  specify("a preflight the site allows lets the request through", async () => {
    const { window, seen, done } = await site();
    try {
      const response = await window.fetch("https://other.test/data?allow&methods=PUT&headers=x-test", {
        method: "PUT",
        headers: { "x-test": "1" }
      });
      assert.equal(response.type, "cors");
      assert.deepEqual(seen.map(one => one.method), ["OPTIONS", "PUT"]);
      assert.equal(seen[0].headers["access-control-request-headers"], "x-test");
      assert.equal(seen[1].headers["x-test"], "1");
    } finally {
      done();
    }
  });

  specify("a preflight answered with a status that is not ok refuses the request", async () => {
    const { window, seen, done } = await site();
    try {
      await assert.rejects(window.fetch("https://other.test/data?allow&methods=PUT&preflightStatus=400", { method: "PUT" }));
      assert.equal(seen.length, 1);
    } finally {
      done();
    }
  });

  specify("a cloned response keeps its type and address", async () => {
    const { window, done } = await site();
    try {
      const response = await window.fetch("https://site.test/data");
      const clone = response.clone();
      assert.equal(clone.type, "basic");
      assert.equal(clone.url, "https://site.test/data");
    } finally {
      done();
    }
  });
});

describe("Helpers: fetch of a data: URL", () => {
  specify("is answered from the URL, as a basic response", async () => {
    const { window } = new JSDOM("", { url: "https://site.test/", virtualConsole: new VirtualConsole() });
    const response = await window.fetch("data:text/plain,hello");

    assert.equal(response.type, "basic");
    assert.equal(await response.text(), "hello");
    window.close();
  });
});
