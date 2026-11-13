"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");
const { fetchSite, fetchMetadataHeaders } = require("../../lib/jsdom/living/helpers/fetch-metadata.js");

describe("Helpers: fetch metadata", () => {
  specify("site is decided by origin, then by registrable domain and scheme", () => {
    assert.equal(fetchSite("https://a.example.com", "https://a.example.com/x"), "same-origin");
    assert.equal(fetchSite("https://a.example.com", "https://b.example.com/x"), "same-site");
    assert.equal(fetchSite("https://wpt.localhost:8443", "https://www1.wpt.localhost:8443/"), "same-site");
    assert.equal(fetchSite("https://wpt.localhost:8443", "https://not-wpt.localhost:8443/"), "cross-site");
    assert.equal(fetchSite("http://a.example.com", "https://a.example.com/"), "cross-site");
    assert.equal(fetchSite(null, "https://a.example.com/"), "none");
  });

  specify("only https is sent them", () => {
    assert.deepEqual(fetchMetadataHeaders({ url: "http://a.example.com/", initiatorOrigin: null, mode: "cors", dest: "" }), {});
    assert.deepEqual(
      fetchMetadataHeaders({ url: "https://a.example.com/", initiatorOrigin: "https://a.example.com", mode: "cors", dest: "" }),
      { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }
    );
  });

  specify("fetch and XHR state their metadata", async () => {
    const seen = [];
    const server = await createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, {
        "Access-Control-Allow-Origin": req.headers.origin || "*",
        "BSBX-PROXY-HOST": req.headers["bsbx-proxy-host"]
      });
      res.end("ok");
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

    try {
      await window.fetch("https://other.test/a", { mode: "no-cors" });
      await new Promise(resolve => {
        const xhr = new window.XMLHttpRequest();
        xhr.open("GET", "https://site.test/b");
        xhr.onloadend = resolve;
        xhr.send();
      });

      assert.equal(seen[0]["sec-fetch-mode"], "no-cors");
      assert.equal(seen[0]["sec-fetch-site"], "cross-site");
      assert.equal(seen[0]["sec-fetch-dest"], "empty");
      assert.equal(seen[1]["sec-fetch-mode"], "cors");
      assert.equal(seen[1]["sec-fetch-site"], "same-origin");
      assert.equal(seen[1]["sec-fetch-dest"], "empty");
    } finally {
      window.close();
      server.destroy();
    }
  });
});
