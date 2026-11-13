"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// The Referer an XHR or fetch sends is the document's address reduced by the
// referrer policy, and it stays the document's across redirects: it was the
// document's full address to every destination, and after a redirect the
// address of the redirect itself.

async function page(head = "") {
  const seen = [];
  const server = await createServer((req, res) => {
    const url = new URL(req.url.replace(/^\/proxy/, ""), req.headers["bsbx-proxy-host"]);

    seen.push({ url: url.href, referer: req.headers.referer });

    const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" };

    if (url.searchParams.has("to")) {
      headers.Location = url.searchParams.get("to");
      if (url.searchParams.has("policy")) {
        headers["Referrer-Policy"] = url.searchParams.get("policy");
      }
      res.writeHead(302, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    res.end("ok");
  });

  class Loader extends ResourceLoader {
    constructor() {
      super();
      this.proxyUrl = `http://127.0.0.1:${server.address().port}/proxy`;
    }
  }

  const { window } = new JSDOM(`<head>${head}</head>`, {
    url: "https://site.test/page?q=1",
    resources: new Loader(),
    virtualConsole: new VirtualConsole()
  });

  return { window, seen, done: () => { window.close(); server.destroy(); } };
}

describe("Helpers: the referrer of an XHR or fetch", () => {
  specify("is the full address to the same origin, and the origin elsewhere", async () => {
    const { window, seen, done } = await page();
    try {
      await window.fetch("https://site.test/a");
      await window.fetch("https://other.test/b");
      assert.equal(seen[0].referer, "https://site.test/page?q=1");
      assert.equal(seen[1].referer, "https://site.test/");
    } finally {
      done();
    }
  });

  specify("follows the policy the document declares", async () => {
    const { window, seen, done } = await page(`<meta name="referrer" content="no-referrer">`);
    try {
      await window.fetch("https://site.test/a");
      assert.equal(seen[0].referer, undefined);
    } finally {
      done();
    }
  });

  specify("follows the policy the request states", async () => {
    const { window, seen, done } = await page();
    try {
      await window.fetch("https://site.test/a", { referrerPolicy: "origin" });
      assert.equal(seen[0].referer, "https://site.test/");
    } finally {
      done();
    }
  });

  specify("stays the document's across a redirect, under the policy the redirect states", async () => {
    const { window, seen, done } = await page();
    try {
      await window.fetch("https://site.test/r?to=/c");
      await window.fetch("https://site.test/r?to=/d&policy=origin");
      assert.equal(seen[1].referer, "https://site.test/page?q=1");
      assert.equal(seen[3].referer, "https://site.test/");
    } finally {
      done();
    }
  });
});
