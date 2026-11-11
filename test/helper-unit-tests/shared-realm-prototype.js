"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// Where a page's scripts run in the realm this library runs in, as binb's do,
// an index the page defines on Object.prototype is read by every lookup this
// library makes into an empty array. Each case sets one and restores it.
//
// Each selector is matched once before the index is defined: nwsapi compiles a
// selector the first time it sees it, and that compilation reads its own arrays
// the same way and fails outright. What is under test is the lookup made with
// a selector already compiled, which is the case a page reaches -- the
// document's own selectors are compiled long before its scripts run.
function withPrototypeIndex(fn) {
  Object.prototype[0] = 5; // eslint-disable-line no-extend-native

  try {
    return fn();
  } finally {
    delete Object.prototype[0];
  }
}

describe("Helpers: a realm shared with the page", () => {
  specify("querySelector with no match answers null", () => {
    const { document } = new JSDOM(`<p></p>`).window;

    document.querySelector("base[href]");
    document.body.querySelector("span");

    withPrototypeIndex(() => {
      assert.equal(document.querySelector("base[href]"), null);
      assert.equal(document.body.querySelector("span"), null);
    });
  });

  specify("a URL resolves against the document where there is no <base>", () => {
    const { document } = new JSDOM(`<script src="a.js"></script>`, { url: "http://example.test/dir/" }).window;

    document.querySelector("base[href]");
    document.querySelector("script");

    withPrototypeIndex(() => {
      assert.equal(document.querySelector("script").src, "http://example.test/dir/a.js");
    });
  });
});
