"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-location-interface
describe("Helpers: a Location object's own properties", () => {
  specify("valueOf is Object.prototype.valueOf, fixed", () => {
    const { window } = new JSDOM(``, { url: "http://location.test/" });
    const prop = Object.getOwnPropertyDescriptor(window.location, "valueOf");
    assert.equal(typeof prop.value, "function");
    assert.equal(prop.value, window.Object.prototype.valueOf);
    assert.deepEqual([prop.enumerable, prop.writable, prop.configurable], [false, false, false]);
  });

  specify("@@toPrimitive is undefined, fixed", () => {
    const { window } = new JSDOM(``, { url: "http://location.test/" });
    const prop = Object.getOwnPropertyDescriptor(window.location, Symbol.toPrimitive);
    assert.ok(prop);
    assert.equal(prop.value, undefined);
    assert.deepEqual([prop.enumerable, prop.writable, prop.configurable], [false, false, false]);
    assert.equal(`${window.location}`, "http://location.test/");
  });
});
