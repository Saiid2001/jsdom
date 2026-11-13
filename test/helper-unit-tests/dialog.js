"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");

// <dialog>'s show(), showModal(), close() and returnValue, and a form with
// method="dialog" closing the dialog it is in. Only `open` was there, so a page
// opening its dialog with showModal() threw where it did: museum-schleusingen.de
// stopped there, every time a script asked.
// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element

function page(body) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    runScripts: "dangerously", virtualConsole: new VirtualConsole()
  });

  return window;
}

const closed = dialog => new Promise(resolve => dialog.addEventListener("close", resolve, { once: true }));

describe("Helpers: the dialog element", () => {
  specify("show() opens it, and close() closes it with a return value and a close event", async () => {
    const window = page(`<dialog id="d">hi</dialog>`);
    const dialog = window.document.getElementById("d");

    assert.equal(window.getComputedStyle(dialog).display, "none");
    dialog.show();
    assert.equal(dialog.open, true);
    assert.notEqual(window.getComputedStyle(dialog).display, "none");

    const event = closed(dialog);
    dialog.close("done");

    assert.equal(dialog.open, false);
    assert.equal(dialog.returnValue, "done");
    await event;
  });

  specify("showModal() opens it fixed over the viewport", () => {
    const window = page(`<dialog id="d">hi</dialog>`);
    const dialog = window.document.getElementById("d");

    dialog.showModal();

    assert.equal(dialog.open, true);
    assert.equal(window.getComputedStyle(dialog).position, "fixed");

    dialog.close();
    assert.notEqual(window.getComputedStyle(dialog).position, "fixed");
  });

  specify("showModal() on a dialog shown non-modally, or not in a document, throws", () => {
    const window = page(`<dialog id="d"></dialog>`);
    const dialog = window.document.getElementById("d");

    dialog.show();
    assert.throws(() => dialog.showModal(), { name: "InvalidStateError" });
    assert.throws(() => window.document.createElement("dialog").showModal(), { name: "InvalidStateError" });
  });

  specify("showing an open dialog the same way again does nothing", () => {
    const window = page(`<dialog id="d"></dialog>`);
    const dialog = window.document.getElementById("d");

    dialog.showModal();
    dialog.showModal();
    assert.equal(dialog.open, true);
  });

  specify("a form with method=dialog closes its dialog with the submitter's value", async () => {
    const window = page(`<dialog id="d" open><form method="dialog"><button id="b" value="yes">Yes</button></form></dialog>`);
    const dialog = window.document.getElementById("d");
    const event = closed(dialog);

    window.document.getElementById("b").click();

    assert.equal(dialog.open, false);
    assert.equal(dialog.returnValue, "yes");
    await event;
  });
});
