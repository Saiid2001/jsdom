"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// A request a host application carries through its proxy goes out addressed to
// the proxy, with the site it is for in BSBX-PROXY-HOST. The cookies it sends
// and the ones its response sets belong to that site, not to the proxy's
// address: keyed by the proxy's, a page's own cookies never reached its XHRs,
// and a cookie an XHR's response set was filed under the proxy and never read.

/** A proxy that answers as the site named in BSBX-PROXY-HOST would. */
async function proxy() {
  const seen = [];
  const server = await createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });

    const headers = {
      "Content-Type": "text/plain",
      "BSBX-PROXY-HOST": req.headers["bsbx-proxy-host"],
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Credentials": "true"
    };

    if (req.url.includes("set")) {
      headers["Set-Cookie"] = "from_response=1; Path=/";
    }

    res.writeHead(200, headers);
    res.end(req.headers.cookie || "");
  });

  return { server, seen, proxyUrl: `http://127.0.0.1:${server.address().port}/proxy` };
}

class ProxyLoader extends ResourceLoader {
  constructor(proxyUrl) {
    super();
    this.proxyUrl = proxyUrl;
  }
}

function pageThrough(proxyUrl) {
  return new JSDOM("", {
    url: "https://site.test/page",
    resources: new ProxyLoader(proxyUrl),
    virtualConsole: new VirtualConsole()
  }).window;
}

function xhr(window, url, withCredentials = false) {
  return new Promise((resolve, reject) => {
    const request = new window.XMLHttpRequest();

    request.open("GET", url);
    request.withCredentials = withCredentials;
    request.onload = () => resolve(request.responseText);
    request.onerror = () => reject(new Error("network error"));
    request.send();
  });
}

describe("Helpers: requests carried through a proxy", () => {
  specify("an XHR sends the cookies of the site it is for", async () => {
    const { server, proxyUrl } = await proxy();
    const window = pageThrough(proxyUrl);

    try {
      window.document.cookie = "mine=1; path=/";

      assert.equal(await xhr(window, "https://site.test/data"), "mine=1");
    } finally {
      window.close();
      server.destroy();
    }
  });

  specify("a cookie an XHR's response sets is the site's", async () => {
    const { server, proxyUrl } = await proxy();
    const window = pageThrough(proxyUrl);

    try {
      await xhr(window, "https://site.test/set");

      assert.match(window.document.cookie, /from_response=1/);
    } finally {
      window.close();
      server.destroy();
    }
  });

  specify("a fetch sends the cookies of the site it is for", async () => {
    const { server, proxyUrl } = await proxy();
    const window = pageThrough(proxyUrl);

    try {
      window.document.cookie = "mine=1; path=/";

      const response = await window.fetch("https://site.test/data");

      assert.equal(await response.text(), "mine=1");
    } finally {
      window.close();
      server.destroy();
    }
  });

  specify("a fetch with credentials omitted sends no cookie", async () => {
    const { server, proxyUrl } = await proxy();
    const window = pageThrough(proxyUrl);

    try {
      window.document.cookie = "mine=1; path=/";

      const response = await window.fetch("https://site.test/data", { credentials: "omit" });

      assert.equal(await response.text(), "");
    } finally {
      window.close();
      server.destroy();
    }
  });
});
