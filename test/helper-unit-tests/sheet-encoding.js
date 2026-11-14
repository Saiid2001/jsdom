"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { cssFallbackEncoding } = require("../../lib/jsdom/living/helpers/encoding.js");

// A fetched style sheet is decoded by its own declarations before the
// document's: a BOM, then the charset of its Content-Type, then an @charset
// rule at its start, and only then the encoding of the document that links it.
// https://drafts.csswg.org/css-syntax/#input-byte-stream

const PAGE = "http://example.test/page.html";

// "ý" in UTF-8 is C3 BD; read as windows-1252 it is "Ã½".
const UTF8_CLASS = Buffer.from([0xC3, 0xBD]);

class Sheets extends ResourceLoader {
  constructor(sheets) {
    super();
    this.sheets = sheets;
  }

  fetch(url) {
    const { type, body } = this.sheets[new URL(url).pathname];
    const request = Promise.resolve(body);
    const headers = { "content-type": type };

    request.response = { statusCode: 200, statusMessage: "OK", headers };
    request.href = url;
    request.abort = () => {};
    request.getHeader = name => headers[name.toLowerCase()] ?? null;
    return request;
  }
}

// A windows-1252 document (no declaration of its own) linking one sheet, whose
// only rule matches the element only if the sheet was decoded as UTF-8.
async function widthUnder(type, sheetBytes) {
  const dom = new JSDOM(Buffer.concat([
    Buffer.from(`<!DOCTYPE html><link rel="stylesheet" href="/s.css"><div id="t" class="`, "latin1"),
    Buffer.from("ý", "latin1"),
    Buffer.from(`"></div>`, "latin1")
  ]), {
    url: PAGE,
    contentType: "text/html",
    resources: new Sheets({ "/s.css": { type, body: sheetBytes } }),
    virtualConsole: new VirtualConsole()
  });
  await new Promise(resolve => {
    dom.window.addEventListener("load", resolve);
  });
  assert.equal(dom.window.document.characterSet, "windows-1252");
  return dom.window.getComputedStyle(dom.window.document.getElementById("t")).width;
}

const rule = prefix => Buffer.concat([Buffer.from(prefix + ".", "latin1"), UTF8_CLASS, Buffer.from(" { width: 100px }")]);

describe("Helpers: style sheet encoding", () => {
  specify("an @charset rule decides over the document's encoding", async () => {
    assert.equal(await widthUnder("text/css", rule(`@charset "utf-8";\n`)), "100px");
  });

  specify("the Content-Type charset decides over the document's encoding", async () => {
    assert.equal(await widthUnder("text/css; charset=utf-8", rule("")), "100px");
  });

  specify("a BOM decides over everything", async () => {
    const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), rule("")]);
    assert.equal(await widthUnder("text/css; charset=windows-1252", bom), "100px");
  });

  specify("a sheet with no declaration of its own takes the document's encoding", async () => {
    assert.notEqual(await widthUnder("text/css", rule("")), "100px");
  });

  describe("cssFallbackEncoding", () => {
    const bytes = text => Buffer.from(text, "latin1");

    specify("the protocol's label comes first", () => {
      assert.equal(cssFallbackEncoding(bytes(`@charset "utf-8";`), {
        protocolLabel: "iso-8859-15", environmentEncoding: "windows-1252"
      }), "ISO-8859-15");
    });

    specify("a label that names no encoding is passed over", () => {
      assert.equal(cssFallbackEncoding(bytes(`@charset "koi8-r";`), {
        protocolLabel: "bogus", environmentEncoding: "windows-1252"
      }), "KOI8-R");
    });

    specify("@charset is matched byte for byte at the very start", () => {
      const env = { environmentEncoding: "windows-1252" };
      assert.equal(cssFallbackEncoding(bytes(`@charset "koi8-r";`), env), "KOI8-R");
      assert.equal(cssFallbackEncoding(bytes(` @charset "koi8-r";`), env), "windows-1252");
      assert.equal(cssFallbackEncoding(bytes(`@charset 'koi8-r';`), env), "windows-1252");
      assert.equal(cssFallbackEncoding(bytes(`@CHARSET "koi8-r";`), env), "windows-1252");
      assert.equal(cssFallbackEncoding(bytes(`@charset "koi8-r"`), env), "windows-1252");
      assert.equal(cssFallbackEncoding(bytes(`@charset  "koi8-r";`), env), "windows-1252");
    });

    specify("@charset naming UTF-16 is read as UTF-8", () => {
      assert.equal(cssFallbackEncoding(bytes(`@charset "utf-16le";`), {}), "UTF-8");
      assert.equal(cssFallbackEncoding(bytes(`@charset "utf-16be";`), {}), "UTF-8");
    });

    specify("@charset beyond the first 1024 bytes is not read", () => {
      const label = "x".repeat(1020);
      assert.equal(cssFallbackEncoding(bytes(`@charset "${label}";`), { environmentEncoding: "ISO-8859-2" }), "ISO-8859-2");
    });

    specify("with nothing to go on, UTF-8", () => {
      assert.equal(cssFallbackEncoding(bytes("p {}"), {}), "UTF-8");
    });
  });
});
