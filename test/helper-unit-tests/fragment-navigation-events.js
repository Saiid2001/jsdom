"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// Navigating to a fragment fires popstate as part of the navigation, synchronously, and queues hashchange.
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-fragid
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-document-for-history-step-application
describe("Helpers: the events a fragment navigation fires", () => {
  specify("popstate before location.hash's setter returns, hashchange later", () => {
    const { window } = new JSDOM(``, { url: "http://fragment.test/" });
    const order = [];
    window.addEventListener("popstate", () => order.push("popstate"));
    window.addEventListener("hashchange", () => order.push("hashchange"));

    window.location.hash = "#1";
    order.push("returned");

    return new Promise(resolve => {
      setTimeout(() => {
        assert.deepEqual(order, ["popstate", "returned", "hashchange"]);
        resolve();
      }, 50);
    });
  });

  specify("history.back() to a fragment fires popstate, then hashchange in a later task", () => {
    const { window } = new JSDOM(``, { url: "http://fragment.test/" });
    window.location.hash = "#1";

    return new Promise(resolve => {
      setTimeout(() => {
        const order = [];
        window.addEventListener("popstate", () => {
          order.push("popstate");
          queueMicrotask(() => order.push("microtask"));
        });
        window.addEventListener("hashchange", () => order.push("hashchange"));
        window.history.back();
        setTimeout(() => {
          assert.deepEqual(order, ["popstate", "microtask", "hashchange"]);
          resolve();
        }, 50);
      }, 20);
    });
  });
});

describe("Helpers: setting location.hash to the fragment the URL already has", () => {
  specify("an empty hash on a URL with none does not navigate", () => {
    const { window } = new JSDOM(``, { url: "http://fragment.test/" });
    const events = [];
    window.addEventListener("popstate", () => events.push("popstate"));
    window.addEventListener("hashchange", () => events.push("hashchange"));

    window.location.hash = "";

    return new Promise(resolve => {
      setTimeout(() => {
        assert.deepEqual(events, []);
        assert.equal(window.location.href, "http://fragment.test/");
        assert.equal(window.history.length, 1);
        resolve();
      }, 50);
    });
  });
});
