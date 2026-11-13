"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, CookieJar } = require("../../lib/api.js");

// An insecure origin may not set a Secure cookie, from script or from a
// response (https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis,
// "storage model", step 14 / "Leave Secure Cookies Alone"). The jar sends a
// Secure cookie to https and wss only, and those are the origins that may set
// one.

describe("Helpers: Secure cookies", () => {
  specify("an http document cannot set one", () => {
    const cookieJar = new CookieJar();
    const { window } = new JSDOM("", { url: "http://site.test/", cookieJar });

    window.document.cookie = "a=1; Secure; path=/";
    window.document.cookie = "__Secure-b=1; Secure; path=/";

    assert.equal(window.document.cookie, "");
    assert.equal(cookieJar.getCookieStringSync("https://site.test/"), "");
  });

  specify("an http response cannot set one", () => {
    const cookieJar = new CookieJar();

    cookieJar.setCookieSync("a=1; Secure; Path=/", "http://site.test/", { ignoreError: true });

    assert.equal(cookieJar.getCookieStringSync("https://site.test/"), "");
  });

  specify("an https document can", () => {
    const cookieJar = new CookieJar();
    const { window } = new JSDOM("", { url: "https://site.test/", cookieJar });

    window.document.cookie = "a=1; Secure; path=/";

    assert.equal(window.document.cookie, "a=1");
  });
});
