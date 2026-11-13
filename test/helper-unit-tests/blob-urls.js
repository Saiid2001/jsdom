"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, resolveBlobURL } = require("../../lib/api.js");

// https://w3c.github.io/FileAPI/#url
describe("Helpers: blob URLs", () => {
  specify("createObjectURL names a Blob under the document's origin, each time anew", () => {
    const { window } = new JSDOM("", { url: "https://example.test/page" });
    const blob = new window.Blob(["abc"], { type: "text/plain" });

    const first = window.URL.createObjectURL(blob);
    const second = window.URL.createObjectURL(blob);

    assert.match(first, /^blob:https:\/\/example\.test\/[0-9a-f-]{36}$/);
    assert.notEqual(first, second);
    assert.equal(new window.URL(first).origin, "https://example.test");
    assert.equal(window.URL.createObjectURL.length, 1);
    assert.equal(window.URL.revokeObjectURL.length, 1);
  });

  specify("createObjectURL takes a Blob and nothing else", () => {
    const { window } = new JSDOM();

    assert.throws(() => window.URL.createObjectURL("x"), TypeError);
    assert.throws(() => window.URL.createObjectURL(), TypeError);
  });

  specify("a URL resolves to its Blob's bytes and type until it is revoked, a fragment notwithstanding", () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });
    const url = window.URL.createObjectURL(new window.File(["hello"], "f", { type: "text/x" }));

    const entry = resolveBlobURL(url + "#frag");
    assert.equal(entry.type, "text/x");
    assert.equal(Buffer.from(entry.buffer).toString(), "hello");

    window.URL.revokeObjectURL(url);
    assert.equal(resolveBlobURL(url), null);
  });

  specify("a document's URLs go with it", () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });
    const url = window.URL.createObjectURL(new window.Blob(["x"]));

    window.close();
    assert.equal(resolveBlobURL(url), null);
  });

  specify("revokeObjectURL leaves another origin's URL alone and ignores anything else", () => {
    const one = new JSDOM("", { url: "https://one.test/" }).window;
    const two = new JSDOM("", { url: "https://two.test/" }).window;
    const url = one.URL.createObjectURL(new one.Blob(["x"]));

    two.URL.revokeObjectURL(url);
    two.URL.revokeObjectURL("not a url");
    two.URL.revokeObjectURL("https://one.test/");
    assert.notEqual(resolveBlobURL(url), null);
  });

  specify("XMLHttpRequest and the resource loader read a blob URL without a request", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });
    const url = window.URL.createObjectURL(new window.Blob(["body text"], { type: "text/plain" }));

    const xhr = new window.XMLHttpRequest();
    xhr.open("GET", url);
    await new Promise((resolve, reject) => {
      xhr.onload = resolve;
      xhr.onerror = reject;
      xhr.send();
    });
    assert.equal(xhr.status, 200);
    assert.equal(xhr.responseText, "body text");
    assert.equal(xhr.getResponseHeader("content-type"), "text/plain");
    assert.equal(xhr.getResponseHeader("content-length"), "9");

    const { ResourceLoader } = require("../../lib/api.js");
    const bytes = await new ResourceLoader().fetch(url, {});
    assert.equal(bytes.toString(), "body text");
  });

  specify("XMLHttpRequest fails a blob URL that names nothing, or a method other than GET", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });
    const url = window.URL.createObjectURL(new window.Blob(["x"]));

    for (const [method, target] of [["GET", "blob:https://example.test/missing"], ["POST", url]]) {
      const xhr = new window.XMLHttpRequest();
      xhr.open(method, target);
      const event = await new Promise(resolve => {
        xhr.onload = () => resolve("load");
        xhr.onerror = () => resolve("error");
        xhr.send();
      });
      assert.equal(event, "error", `${method} ${target}`);
    }
  });

  specify("fetch reads a blob URL, fails one revoked, and keeps what a Request already named", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });
    const url = window.URL.createObjectURL(new window.Blob(["fetched"], { type: "text/x" }));

    const response = await window.fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/x");
    assert.equal(await response.text(), "fetched");

    const request = new window.Request(url);
    window.URL.revokeObjectURL(url);

    await assert.rejects(window.fetch(url), TypeError);
    await assert.rejects(window.fetch(request.url, { method: "POST" }), TypeError);
    assert.equal(await (await window.fetch(request)).text(), "fetched");
  });
});
