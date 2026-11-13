"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A document's URLs are parsed with its character encoding, which reaches only
// the query of a special, non-WebSocket URL.
// https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-a-url
// https://url.spec.whatwg.org/#query-state

function documentIn(charset) {
  const { window } = new JSDOM(Buffer.from("<!DOCTYPE html><body></body>"), {
    url: "https://example.test/page.html",
    contentType: `text/html; charset=${charset}`
  });
  assert.equal(window.document.characterSet.toLowerCase(), charset.toLowerCase());
  return window.document;
}

function searchOf(document, query, prefix = "https://example.com/") {
  const a = document.createElement("a");
  a.href = `${prefix}?${query}`;
  return a.search.slice(1);
}

describe("Helpers: a URL's query takes its document's encoding", () => {
  specify("UTF-8 is unchanged", () => {
    assert.equal(searchOf(documentIn("UTF-8"), "劍"), "%E5%8A%8D");
  });

  specify("windows-1252", () => {
    const document = documentIn("windows-1252");
    assert.equal(searchOf(document, "é€"), "%E9%80");
    assert.equal(searchOf(document, "☃"), "%26%239731%3B");
  });

  specify("Shift_JIS", () => {
    const document = documentIn("Shift_JIS");
    assert.equal(searchOf(document, "劍"), "%99%98");
    assert.equal(searchOf(document, "¥｡"), "\\%A1");
    assert.equal(searchOf(document, "켨"), "%26%2353032%3B");
  });

  specify("EUC-JP", () => {
    const document = documentIn("EUC-JP");
    assert.equal(searchOf(document, "亜｡"), "%B0%A1%8E%A1");
    assert.equal(searchOf(document, "䃺"), "%26%2316634%3B");
  });

  specify("ISO-2022-JP returns to ASCII before an error and at the end", () => {
    const document = documentIn("ISO-2022-JP");
    assert.equal(searchOf(document, "亜a"), "%1B$B0!%1B(Ba");
    assert.equal(searchOf(document, "亜☃"), "%1B$B0!%1B(B%26%239731%3B");
    assert.equal(searchOf(document, "亜"), "%1B$B0!%1B(B");
  });

  specify("ISO-2022-JP named by a meta charset alone", () => {
    const { window } = new JSDOM(Buffer.from("<!DOCTYPE html><meta charset=iso-2022-jp><body></body>"), {
      url: "https://example.test/page.html"
    });
    assert.equal(window.document.characterSet, "ISO-2022-JP");
    assert.equal(searchOf(window.document, "\u0393"), "%1B$B&%23%1B(B");
  });

  specify("EUC-KR", () => {
    const document = documentIn("EUC-KR");
    assert.equal(searchOf(document, "가"), "%B0%A1");
    assert.equal(searchOf(document, "涨"), "%26%2328072%3B");
  });

  specify("Big5 excludes the HKSCS pointers and prefers the last of a few", () => {
    const document = documentIn("Big5");
    assert.equal(searchOf(document, "　═"), "%A1@%F9%F9");
    assert.equal(searchOf(document, "麦"), "%26%2340614%3B");
  });

  specify("gb18030 and GBK", () => {
    const gb18030 = documentIn("gb18030");
    assert.equal(searchOf(gb18030, "€丂"), "%A2%E3%81@");
    assert.equal(searchOf(gb18030, ""), "%26%2358853%3B");
    assert.equal(searchOf(gb18030, "\u{1F4A9}"), "%949%DA3");
    assert.equal(searchOf(gb18030, ""), "%815%F47%A6%D9");

    const gbk = documentIn("GBK");
    assert.equal(searchOf(gbk, "€"), "%80");
    assert.equal(searchOf(gbk, "\u{1F4A9}"), "%26%23128169%3B");
  });

  specify("percent signs already in the query are kept", () => {
    assert.equal(searchOf(documentIn("Shift_JIS"), "%41劍"), "%41%99%98");
  });

  specify("non-special and WebSocket URLs stay UTF-8", () => {
    const document = documentIn("Shift_JIS");
    assert.equal(searchOf(document, "劍", "foo://example.com/"), "%E5%8A%8D");
    assert.equal(searchOf(document, "劍", "wss://example.com/"), "%E5%8A%8D");
  });

  specify("the fragment stays UTF-8", () => {
    const a = documentIn("Shift_JIS").createElement("a");
    a.href = "https://example.com/?\u528D#\u528D";
    assert.equal(a.search, "?%99%98");
    assert.equal(a.hash, "#%E5%8A%8D");
  });
});

// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#selecting-a-form-submission-encoding
// https://url.spec.whatwg.org/#concept-urlencoded-serializer
describe("Helpers: a form is submitted in its encoding", () => {
  function submitted(charset, value, acceptCharset = null) {
    const { window } = new JSDOM(Buffer.from(`<!DOCTYPE html><form action="/next"><input name="q"></form>`), {
      url: "https://example.test/page.html",
      contentType: `text/html; charset=${charset}`
    });
    const form = window.document.querySelector("form");
    if (acceptCharset !== null) {
      form.setAttribute("accept-charset", acceptCharset);
    }
    form.querySelector("input").value = value;
    const navigations = [];
    window.document.addEventListener("navigate", event => navigations.push(event.detail.url));
    form.submit();
    return navigations;
  }

  specify("UTF-8 encodes each character's bytes, and a space as +", () => {
    assert.deepEqual(submitted("UTF-8", "\u00E9 \u528D*-._~"), ["https://example.test/next?q=%C3%A9+%E5%8A%8D*-._%7E"]);
  });

  specify("the document's encoding", () => {
    assert.deepEqual(submitted("Shift_JIS", "\u528D\uCF28"), ["https://example.test/next?q=%99%98%26%2353032%3B"]);
  });

  specify("the first label of accept-charset that names an encoding", () => {
    assert.deepEqual(submitted("UTF-8", "\uAC00", "bogus euc-kr shift_jis"), ["https://example.test/next?q=%B0%A1"]);
  });

  specify("UTF-16 submits as UTF-8", () => {
    assert.deepEqual(submitted("windows-1252", "\u00E9", "utf-16le"), ["https://example.test/next?q=%C3%A9"]);
  });
});

describe("Helpers: decoders whatwg-encoding lacks", () => {
  specify("FileReader reads text as ISO-2022-JP", async () => {
    const { window } = new JSDOM();
    const reader = new window.FileReader();
    const read = new Promise(resolve => {
      reader.onload = () => resolve(reader.result);
    });
    const bytes = new Uint8Array([0x1B, 0x24, 0x42, 0x30, 0x21, 0x1B, 0x28, 0x42]);
    reader.readAsText(new window.Blob([bytes]), "iso-2022-jp");
    assert.equal(await read, "亜");
  });
});
