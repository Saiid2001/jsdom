"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

function isDOMException(window, name) {
  return error => error instanceof window.DOMException && error.name === name;
}

// https://privacycg.github.io/storage-access/#the-document-object
describe("Helpers: Storage Access API", () => {
  specify("a top-level document has storage access, and a request for it resolves", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });

    assert.equal(await window.document.hasStorageAccess(), true);
    assert.equal(await window.document.requestStorageAccess(), undefined);
  });

  specify("an insecure context has none and is refused it", async () => {
    const { window } = new JSDOM("", { url: "http://example.test/" });

    assert.equal(await window.document.hasStorageAccess(), false);
    await assert.rejects(window.document.requestStorageAccess(), isDOMException(window, "NotAllowedError"));
  });

  specify("an opaque origin has none and is refused it", async () => {
    const { window } = new JSDOM("", { url: "about:blank" });

    assert.equal(await window.document.hasStorageAccess(), false);
    await assert.rejects(window.document.requestStorageAccess(), isDOMException(window, "NotAllowedError"));
  });

  specify("a document that is not fully active rejects with an InvalidStateError", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });
    const created = window.document.implementation.createDocument("", null);
    const parsed = new window.DOMParser().parseFromString("<p>", "text/html");

    for (const document of [created, parsed]) {
      await assert.rejects(document.hasStorageAccess(), isDOMException(window, "InvalidStateError"));
      await assert.rejects(document.requestStorageAccess(), isDOMException(window, "InvalidStateError"));
    }
  });

  specify("a same-origin frame has storage access", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });
    const frame = window.document.createElement("iframe");
    window.document.body.appendChild(frame);

    assert.equal(frame.contentDocument.location.href, "about:blank");
    assert.equal(await frame.contentDocument.hasStorageAccess(), true);
    assert.equal(await frame.contentDocument.requestStorageAccess(), undefined);
  });
});
