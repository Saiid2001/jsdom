"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// A redirect answered to a request carried through the host's proxy is this
// library's to follow, as it follows any other: the next request is for the
// address the redirect names, so it is the proxy's word for that site --
// BSBX-PROXY-HOST names it -- and the checks a redirect is subject to (CORS,
// userinfo, fetch's redirect mode) see the real addresses, never the proxy's.

async function proxy() {
  const seen = [];
  const server = await createServer((req, res) => {
    const host = req.headers["bsbx-proxy-host"];
    const url = new URL(req.url.replace(/^\/proxy/, ""), host);

    seen.push({ url: url.href, method: req.method, headers: req.headers });

    const headers = {
      "Content-Type": "text/plain",
      "Access-Control-Allow-Origin": req.headers.origin || "*"
    };

    if (url.searchParams.has("to")) {
      headers.Location = url.searchParams.get("to");
      res.writeHead(Number(url.searchParams.get("code") || 302), headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    res.end(`at ${url.href}`);
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

function xhr(window, url, method = "GET", body = null, headers = {}) {
  return new Promise(resolve => {
    const request = new window.XMLHttpRequest();

    request.open(method, url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.onload = () => resolve({ ok: true, status: request.status, text: request.responseText, url: request.responseURL });
    request.onerror = () => resolve({ ok: false });
    request.send(body);
  });
}

describe("Helpers: redirects through a proxy", () => {
  specify("an XHR follows a redirect to another site, asking the proxy for that site", async () => {
    const { window, seen, done } = await proxy();
    try {
      const result = await xhr(window, "https://site.test/a?to=https://other.test/b");

      assert.equal(result.ok, true);
      assert.equal(result.text, "at https://other.test/b");
      assert.equal(result.url, "https://other.test/b");
      assert.equal(seen[1].headers["bsbx-proxy-host"], "https://other.test");
      // The document's, reduced for another origin: never the redirect's address.
      assert.equal(seen[1].headers.referer, "https://site.test/");
    } finally {
      done();
    }
  });

  specify("a relative redirect resolves against the site, not the proxy", async () => {
    const { window, seen, done } = await proxy();
    try {
      const result = await xhr(window, "https://site.test/a?to=/c");

      assert.equal(result.text, "at https://site.test/c");
      assert.equal(seen[1].url, "https://site.test/c");
    } finally {
      done();
    }
  });

  specify("a cross-origin redirect to an address with userinfo is a network error", async () => {
    const { window, done } = await proxy();
    try {
      const result = await xhr(window, "https://other.test/a?to=https://user:pass@other.test/b");

      assert.equal(result.ok, false);
    } finally {
      done();
    }
  });

  specify("fetch's redirect modes", async () => {
    const { window, done } = await proxy();
    try {
      const manual = await window.fetch("https://site.test/a?to=/c", { redirect: "manual" });

      assert.equal(manual.type, "opaqueredirect");
      assert.equal(manual.status, 0);

      await assert.rejects(window.fetch("https://site.test/a?to=/c", { redirect: "error" }));

      const followed = await window.fetch("https://site.test/a?to=/c");

      assert.equal(await followed.text(), "at https://site.test/c");
      assert.equal(followed.url, "https://site.test/c");
      assert.equal(followed.redirected, true);
    } finally {
      done();
    }
  });

  specify("only 301, 302, 303, 307 and 308 are redirects", async () => {
    const { window, seen, done } = await proxy();
    try {
      const result = await xhr(window, "https://site.test/a?code=300&to=/c");

      assert.equal(result.status, 300);
      assert.equal(seen.length, 1);
    } finally {
      done();
    }
  });

  specify("a POST redirected as a GET loses the headers that described its body", async () => {
    const { window, seen, done } = await proxy();
    try {
      await xhr(window, "https://site.test/a?code=302&to=/c", "POST", "x".repeat(100));

      assert.equal(seen[1].method, "GET");
      assert.equal(seen[1].headers["content-length"], undefined);
      assert.equal(seen[1].headers["content-type"], undefined);
    } finally {
      done();
    }
  });

  specify("a redirect to a data: URL is a network error", async () => {
    const { window, done } = await proxy();
    try {
      const result = await xhr(window, "https://site.test/a?to=data:text/plain,hi");

      assert.equal(result.ok, false);
    } finally {
      done();
    }
  });

  specify("a preflight names the request's headers lowercased, sorted, joined by commas", async () => {
    const { window, seen, done } = await proxy();
    try {
      await xhr(window, "https://other.test/a", "GET", null, { "X-B": "1", "X-A": "2" });

      assert.equal(seen[0].method, "OPTIONS");
      assert.equal(seen[0].headers["access-control-request-headers"], "x-a,x-b");
    } finally {
      done();
    }
  });

  specify("a preflighted upload states its length from the start", async () => {
    const { window, done } = await proxy();
    try {
      const loadstart = await new Promise(resolve => {
        const request = new window.XMLHttpRequest();

        request.upload.onloadstart = e => resolve([e.loaded, e.total, e.lengthComputable]);
        request.open("POST", "https://other.test/a");
        request.send("twelve bytes");
      });

      assert.deepEqual(loadstart, [0, 12, true]);
    } finally {
      done();
    }
  });
});
