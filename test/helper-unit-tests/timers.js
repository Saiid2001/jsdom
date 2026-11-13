"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers
describe("Helpers: timers", () => {
  specify("clearInterval() clears a timeout, and clearTimeout() an interval", () => {
    const { window } = new JSDOM(``);
    const fired = [];
    window.clearInterval(window.setTimeout(() => fired.push("timeout"), 0));
    window.clearTimeout(window.setInterval(() => fired.push("interval"), 0));

    return new Promise(resolve => {
      setTimeout(() => {
        assert.deepEqual(fired, []);
        resolve();
      }, 50);
    });
  });

  specify("a callback's `this` is the window", () => {
    const { window } = new JSDOM(``);
    return new Promise(resolve => {
      window.setTimeout(function () {
        assert.equal(this, window);
        resolve();
      }, 0);
    });
  });

  specify("what a callback throws is reported at the window", () => {
    const { window } = new JSDOM(``, { virtualConsole: new (require("../../lib/api.js").VirtualConsole)() });
    return new Promise(resolve => {
      window.addEventListener("error", event => {
        assert.equal(event.error.message, "thrown from a timer");
        resolve();
      });
      window.setTimeout(() => {
        throw new Error("thrown from a timer");
      }, 0);
    });
  });
});

// https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror
describe("Helpers: reportError()", () => {
  specify("fires error at the window with the value reported, without reading it", () => {
    const { window } = new JSDOM(``, { virtualConsole: new (require("../../lib/api.js").VirtualConsole)() });
    const reported = {
      get message() {
        throw new Error("read");
      }
    };
    let seen = null;
    window.addEventListener("error", event => {
      seen = event;
    });
    window.reportError(reported);
    assert.equal(seen.error, reported);
    assert.notEqual(seen.message, "");
    assert.throws(() => window.reportError(), TypeError);
  });

  specify("clientInformation is the navigator, and replaceable", () => {
    const { window } = new JSDOM(``);
    assert.equal(window.clientInformation, window.navigator);
    window.clientInformation = 1;
    assert.equal(window.clientInformation, 1);
  });
});
