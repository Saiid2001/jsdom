"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// The load event waits for the document's queues to stay empty for a moment, so a
// chain of scripts that leaves a gap between links is not cut short. With nothing
// in flight that moment is short: a page timing its load event against a timer of
// its own, as event-order tests do, sees load first.
describe("Helpers: load event after a quiet queue", () => {
  specify("with nothing in flight, load fires before a 60ms timer set as parsing ends", () => {
    const dom = new JSDOM(`<p>hello</p>`);
    const order = [];
    setTimeout(() => order.push("timer"), 60);
    dom.window.addEventListener("load", () => order.push("load"));

    return new Promise(resolve => {
      setTimeout(() => {
        assert.deepEqual(order, ["load", "timer"]);
        resolve();
      }, 300);
    });
  });
});
