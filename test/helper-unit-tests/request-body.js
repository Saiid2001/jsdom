"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://fetch.spec.whatwg.org/#concept-bodyinit-extract: a Request's body is
// its init's bytes, with the content type its kind gives it.
function page() {
  return new JSDOM("", { url: "https://example.test/" }).window;
}

describe("Helpers: a Request's body", () => {
  specify("FormData is encoded as multipart/form-data with a boundary of its own", async () => {
    const window = page();
    const data = new window.FormData();
    data.append("a\nb", "line1\nline2");
    data.append("file", new window.File(["bytes"], "f\"\r.txt", { type: "text/plain" }));
    data.append("blob", new window.Blob(["x"]));

    const request = new window.Request("/upload", { method: "POST", body: data });
    const type = request.headers.get("content-type");
    const boundary = type.match(/^multipart\/form-data; boundary=(.+)$/)[1];

    assert.equal(await request.text(), [
      `--${boundary}`,
      `Content-Disposition: form-data; name="a%0D%0Ab"`,
      "",
      "line1\r\nline2",
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="f%22%0D.txt"`,
      "Content-Type: text/plain",
      "",
      "bytes",
      `--${boundary}`,
      `Content-Disposition: form-data; name="blob"; filename="blob"`,
      "Content-Type: application/octet-stream",
      "",
      "x",
      `--${boundary}--`,
      ""
    ].join("\r\n"));
  });

  specify("a Blob, a string and a buffer are their bytes, with their types", async () => {
    const window = page();
    const cases = [
      [new window.Blob(["blob"], { type: "a/b" }), "blob", "a/b"],
      ["text", "text", "text/plain;charset=UTF-8"],
      [new Uint8Array([104, 105]), "hi", null]
    ];

    for (const [body, text, type] of cases) {
      const request = new window.Request("/", { method: "POST", body });
      assert.equal(request.headers.get("content-type"), type);
      assert.equal(await request.text(), text);
    }
  });

  specify("a content type the page set is kept", () => {
    const window = page();
    const request = new window.Request("/", {
      method: "POST", body: "x", headers: { "Content-Type": "application/json" }
    });
    assert.equal(request.headers.get("content-type"), "application/json");
  });

  specify("fetch sends the extracted body", async () => {
    const { createServer } = require("../util.js");
    const server = await createServer((req, res) => {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
        res.end(`${req.headers["content-type"]}|${Buffer.concat(chunks).toString()}`);
      });
    });

    try {
      const base = `http://127.0.0.1:${server.address().port}/`;
      const { window } = new JSDOM("", { url: base });
      const response = await window.fetch(base, { method: "POST", body: new window.Blob(["sent"], { type: "a/b" }) });
      assert.equal(await response.text(), "a/b|sent");
    } finally {
      server.destroy();
    }
  });
});
