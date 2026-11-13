"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://w3c.github.io/FileAPI/#blob-section
describe("Helpers: reading a Blob", () => {
  specify("text() decodes the bytes as UTF-8", async () => {
    const { window } = new JSDOM();
    const blob = new window.Blob(["héllo ", new Uint8Array([0xF0, 0x9F, 0x98, 0x80]), new Uint8Array([0xFF])]);

    assert.equal(await blob.text(), "héllo \u{1F600}�");
  });

  specify("arrayBuffer() and bytes() answer a copy of the bytes", async () => {
    const { window } = new JSDOM();
    const blob = new window.Blob(["abc"]).slice(1);

    const buffer = await blob.arrayBuffer();
    assert.ok(buffer instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(buffer)], [98, 99]);

    const bytes = await blob.bytes();
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual([...bytes], [98, 99]);
    bytes[0] = 0;
    assert.deepEqual([...await blob.bytes()], [98, 99]);
  });

  specify("a File reads as the Blob it is", async () => {
    const { window } = new JSDOM();
    const file = new window.File(["x"], "f.txt");

    assert.equal(await file.text(), "x");
  });

  specify("stream() is absent without the Streams interfaces and reads the bytes with them", async () => {
    const { setStreams } = require("../../lib/api.js");
    const { window } = new JSDOM();
    const blob = new window.Blob(["stream me"]);

    setStreams(null);
    assert.throws(() => blob.stream());

    setStreams(() => ({ ReadableStream }));

    try {
      const reader = blob.stream().getReader();
      const chunks = [];

      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        assert.ok(read.value instanceof Uint8Array);
        chunks.push(...read.value);
      }

      assert.equal(Buffer.from(chunks).toString(), "stream me");
    } finally {
      setStreams(null);
    }
  });
});
