"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// A form submission plans its navigation as a task; window.stop() in the same task cancels it.
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#plan-to-navigate
// https://github.com/whatwg/html/issues/3730
function submitted(stop) {
  const { window } = new JSDOM(`<form id="f" action="/next"></form>`, { url: "http://form.test/page" });
  const navigations = [];
  window.document.addEventListener("navigate", event => navigations.push(event.detail.url));
  window.document.getElementById("f").submit();
  const synchronous = navigations.length;
  if (stop) {
    window.stop();
  }
  return new Promise(resolve => {
    setTimeout(() => resolve({ synchronous, navigations }), 30);
  });
}

describe("Helpers: a form's planned navigation", () => {
  specify("is navigated to in a later task", async () => {
    const { synchronous, navigations } = await submitted(false);
    assert.equal(synchronous, 0);
    assert.deepEqual(navigations, ["http://form.test/next"]);
  });

  specify("is cancelled by window.stop() in the same task", async () => {
    const { navigations } = await submitted(true);
    assert.deepEqual(navigations, []);
  });
});
