"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole, CookieJar, setClearSiteData } = require("../../lib/api.js");
const { createServer } = require("../util.js");
const { parseClearSiteData, clearSiteDataForResponse } =
  require("../../lib/jsdom/living/helpers/clear-site-data.js");

// Clear-Site-Data (https://w3c.github.io/webappsec-clear-site-data/): a
// response from a secure origin naming "cookies" removes the cookies of that
// origin's site, and the rest is handed to the host application's provider.

function jarWith(...pairs) {
  const jar = new CookieJar();
  for (const [cookie, url] of pairs) {
    jar.setCookieSync(cookie, url);
  }
  return jar;
}

describe("Helpers: Clear-Site-Data", () => {
  specify("parses quoted types, \"*\" being all of them", () => {
    assert.deepEqual([...parseClearSiteData("\"cookies\", \"storage\"")].sort(), ["cookies", "storage"]);
    assert.deepEqual([...parseClearSiteData("\"*\"")].sort(), ["cache", "cookies", "executionContexts", "storage"]);
    assert.deepEqual([...parseClearSiteData("cookies, \"Cookies\", \"bogus\"")], []);
  });

  specify("\"cookies\" removes the cookies of the response's site, subdomains included, and no other", () => {
    const jar = jarWith(
      ["a=1", "https://example.com/"],
      ["b=1; Domain=example.com", "https://www.example.com/"],
      ["c=1", "https://other.test/"]
    );

    clearSiteDataForResponse({
      url: "https://www.example.com/x",
      headers: { "clear-site-data": "\"cookies\"" },
      cookieJar: jar
    });

    assert.equal(jar.getCookieStringSync("https://example.com/"), "");
    assert.equal(jar.getCookieStringSync("https://www.example.com/"), "");
    assert.equal(jar.getCookieStringSync("https://other.test/"), "c=1");
  });

  specify("a response from an insecure origin clears nothing", () => {
    const jar = jarWith(["a=1", "http://example.com/"]);
    const types = clearSiteDataForResponse({
      url: "http://example.com/",
      headers: { "clear-site-data": "\"*\"" },
      cookieJar: jar
    });

    assert.equal(types.size, 0);
    assert.equal(jar.getCookieStringSync("http://example.com/"), "a=1");
  });

  specify("localhost is potentially trustworthy over http", () => {
    const jar = jarWith(["a=1", "http://wpt.localhost/"]);
    clearSiteDataForResponse({
      url: "http://wpt.localhost/",
      headers: { "clear-site-data": "\"cookies\"" },
      cookieJar: jar
    });

    assert.equal(jar.getCookieStringSync("http://wpt.localhost/"), "");
  });

  specify("a response to a request made from another site clears nothing", () => {
    const jar = jarWith(["a=1", "https://example.com/"]);
    clearSiteDataForResponse({
      url: "https://example.com/",
      headers: { "clear-site-data": "\"cookies\"" },
      cookieJar: jar,
      topLevelURL: "https://other.test/"
    });

    assert.equal(jar.getCookieStringSync("https://example.com/"), "a=1");
  });

  specify("the provider is told the origin, the site and the types", () => {
    const calls = [];
    setClearSiteData(call => calls.push(call));
    try {
      clearSiteDataForResponse({
        url: "https://a.example.com/x",
        headers: { "Clear-Site-Data": "\"storage\", \"cache\"" },
        cookieJar: new CookieJar()
      });
    } finally {
      setClearSiteData(null);
    }

    assert.equal(calls.length, 1);
    assert.equal(calls[0].origin, "https://a.example.com");
    assert.equal(calls[0].site, "example.com");
    assert.deepEqual([...calls[0].types].sort(), ["cache", "storage"]);
  });

  specify("a fetch() response clears cookies after storing the ones it sets", async () => {
    const server = await createServer((req, res) => {
      res.writeHead(200, {
        "BSBX-PROXY-HOST": req.headers["bsbx-proxy-host"],
        "Content-Type": "text/plain",
        "Set-Cookie": "fresh=1; Path=/",
        "Clear-Site-Data": "\"cookies\""
      });
      res.end("ok");
    });

    class Loader extends ResourceLoader {
      constructor() {
        super();
        this.proxyUrl = `http://127.0.0.1:${server.address().port}/proxy`;
      }
    }

    const jar = jarWith(["old=1", "https://site.test/"]);
    const { window } = new JSDOM("", {
      url: "https://site.test/page",
      resources: new Loader(),
      cookieJar: jar,
      virtualConsole: new VirtualConsole()
    });

    try {
      const response = await window.fetch("https://site.test/clear");
      await response.text();
      assert.equal(jar.getCookieStringSync("https://site.test/"), "");
    } finally {
      window.close();
      server.destroy();
    }
  });
});
