"use strict";
const assert = require("node:assert/strict");
const { describe, specify, afterEach } = require("mocha-sugar-free");

const { JSDOM, setStorageUsage } = require("../../lib/api.js");
const { STORAGE_QUOTA } = require("../../lib/jsdom/living/helpers/storage-usage.js");

// https://storage.spec.whatwg.org/#api
describe("Helpers: StorageManager", () => {
  afterEach(() => setStorageUsage(null));

  specify("navigator.storage is one StorageManager per window, in a secure context", () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });

    assert.ok(window.navigator.storage instanceof window.StorageManager);
    assert.equal(window.navigator.storage, window.navigator.storage);
    assert.throws(() => new window.StorageManager(), window.TypeError);
  });

  specify("persisted() and persist() resolve false", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });

    assert.equal(await window.navigator.storage.persisted(), false);
    assert.equal(await window.navigator.storage.persist(), false);
    assert.equal(await window.navigator.storage.persisted(), false);
  });

  specify("estimate() answers the constant quota and the origin's Web Storage usage", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });

    const before = await window.navigator.storage.estimate();
    assert.deepEqual(Object.keys(before).sort(), ["quota", "usage"]);
    assert.equal(before.quota, STORAGE_QUOTA);
    assert.equal(before.usage, 0);

    window.localStorage.setItem("key", "value");
    const after = await window.navigator.storage.estimate();
    assert.equal(after.usage, ("key".length + "value".length) * 2);
    assert.equal(after.quota, STORAGE_QUOTA);

    // sessionStorage is not on the storage shelf.
    window.sessionStorage.setItem("other", "x".repeat(100));
    assert.equal((await window.navigator.storage.estimate()).usage, after.usage);
  });

  specify("estimate() adds the usage the host application reports for the origin", async () => {
    const asked = [];
    setStorageUsage(origin => {
      asked.push(origin);
      return Promise.resolve(1000);
    });
    const { window } = new JSDOM("", { url: "https://example.test/path" });

    window.localStorage.setItem("a", "b");
    const estimate = await window.navigator.storage.estimate();

    assert.equal(estimate.usage, 1004);
    assert.deepEqual(asked, ["https://example.test"]);
  });

  specify("a usage the host application cannot report counts as none", async () => {
    setStorageUsage(() => {
      throw new Error("unavailable");
    });
    const { window } = new JSDOM("", { url: "https://example.test/" });

    assert.equal((await window.navigator.storage.estimate()).usage, 0);
  });

  specify("an opaque origin has no storage shelf: every method rejects with a TypeError", async () => {
    const { window } = new JSDOM("", { url: "about:blank" });
    const { storage } = window.navigator;

    for (const method of ["estimate", "persisted", "persist"]) {
      await assert.rejects(storage[method](), error => error instanceof window.TypeError, method);
    }
  });

  specify("a method called on something else rejects rather than throws", async () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });

    await assert.rejects(window.StorageManager.prototype.estimate.call({}), TypeError);
  });

  specify("is absent from a window that is not a secure context", () => {
    const { window } = new JSDOM("", { url: "http://example.test/" });

    assert.equal(window.navigator.storage, undefined);
    assert.equal("storage" in window.navigator, false);
    assert.equal("StorageManager" in window, false);
  });

  specify("loopback and localhost origins are secure contexts", () => {
    for (const url of ["http://localhost:8000/", "http://wpt.localhost/", "http://127.0.0.1/", "http://[::1]/"]) {
      const { window } = new JSDOM("", { url });
      assert.ok(window.navigator.storage instanceof window.StorageManager, url);
    }
  });
});
