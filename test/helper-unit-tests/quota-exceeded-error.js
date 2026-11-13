"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://webidl.spec.whatwg.org/#quotaexceedederror
describe("Helpers: QuotaExceededError", () => {
  specify("is a DOMException with a quota and a requested amount", () => {
    const { window } = new JSDOM();
    const error = new window.QuotaExceededError("full", { quota: 10, requested: 12 });

    assert.ok(error instanceof window.DOMException);
    assert.equal(Object.getPrototypeOf(window.QuotaExceededError), window.DOMException);
    assert.equal(error.name, "QuotaExceededError");
    assert.equal(error.code, 22);
    assert.equal(error.message, "full");
    assert.equal(error.quota, 10);
    assert.equal(error.requested, 12);

    const bare = new window.QuotaExceededError();
    assert.equal(bare.quota, null);
    assert.equal(bare.requested, null);
    assert.equal(bare.message, "");
  });

  specify("refuses a negative amount, or less requested than the quota", () => {
    const { window } = new JSDOM();

    assert.throws(() => new window.QuotaExceededError("", { quota: -1 }), RangeError);
    assert.throws(() => new window.QuotaExceededError("", { requested: -1 }), RangeError);
    assert.throws(() => new window.QuotaExceededError("", { quota: 5, requested: 4 }), RangeError);
  });

  specify("is what storage throws when it is full", () => {
    const { window } = new JSDOM("", { url: "https://example.test/", storageQuota: 100 });

    function isQuotaExceeded(error) {
      return error.constructor === window.QuotaExceededError && error.quota === null && error.requested === null;
    }
    assert.throws(() => window.localStorage.setItem("k", "x".repeat(200)), isQuotaExceeded);
  });
});
