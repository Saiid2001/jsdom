"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A window is its own global: `globalThis` read off it is the window, as
// `self` and `window` are. Scripts here are evaluated against the window by a
// host-supplied `vm`, so the value the context answers for `globalThis` is the
// context's own global and not this window.
describe("Helpers: the window's globalThis", () => {
  for (const runScripts of ["dangerously", "outside-only"]) {
    specify(`is the window (runScripts: ${runScripts})`, () => {
      const { window } = new JSDOM(``, { runScripts });

      // Compared by identity: a failing deep comparison of two windows prints
      // both of them whole.
      assert.ok(window.globalThis === window, "globalThis is not the window");
      assert.ok(window.globalThis === window.self, "globalThis is not self");

      window.close();
    });
  }
});
