"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// https://html.spec.whatwg.org/multipage/document-lifecycle.html#navigating-across-documents:
// an image/svg+xml response is an XML document, and is loaded as one, not as
// an image shown in a document of its own.
describe("Helpers: an SVG document loaded from a URL", () => {
  specify("is an XML document whose root is the svg element", async () => {
    const server = await createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><title>t</title><text id="x">a</text></svg>`);
    });

    try {
      const dom = await JSDOM.fromURL(`http://127.0.0.1:${server.address().port}/a.svg`);
      const { document } = dom.window;

      assert.equal(document.contentType, "image/svg+xml");
      assert.equal(document.documentElement.localName, "svg");
      assert.equal(document.documentElement.namespaceURI, "http://www.w3.org/2000/svg");
      assert.equal(document.getElementById("x").textContent, "a");
    } finally {
      server.destroy();
    }
  });

  specify("an image of another type is still shown in a document of its own", async () => {
    const server = await createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    });

    try {
      const dom = await JSDOM.fromURL(`http://127.0.0.1:${server.address().port}/a.png`);
      assert.equal(dom.window.document.querySelector("img").src.slice(0, 22), "data:image/png;base64,");
    } finally {
      server.destroy();
    }
  });
});
