"use strict";
const assert = require("node:assert/strict");
const { describe, specify, afterEach } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole, setRenderingInvalidation, implSymbol } = require("../../lib/api.js");

// What a host that paints the document is told of a change to how an element renders that no mutation record
// carries: a popover shown or hidden, an element entering or leaving the top layer.

function page(body) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, { virtualConsole: new VirtualConsole() });
  return { window, document: window.document };
}

function listen() {
  const heard = [];
  setRenderingInvalidation(elementImpl => heard.push(elementImpl));
  return heard;
}

describe("Helpers: rendering invalidation", () => {
  afterEach(() => {
    setRenderingInvalidation(null);
  });

  specify("showing and hiding a popover is heard for the popover", () => {
    const { document } = page(`<div id=p popover>p</div>`);
    const popover = document.getElementById("p");
    const heard = listen();

    popover.showPopover();
    assert.ok(heard.length > 0, "heard on show");
    assert.ok(heard.every(impl => impl === popover[implSymbol]));

    heard.length = 0;
    popover.hidePopover();
    assert.ok(heard.length > 0, "heard on hide");
    assert.ok(heard.every(impl => impl === popover[implSymbol]));
  });

  specify("a popover invoker's click is heard for the popover it shows", () => {
    const { document } = page(`<button popovertarget=p>open</button><div id=p popover>p</div>`);
    const popover = document.getElementById("p");
    const heard = listen();

    document.querySelector("button").click();
    assert.equal(popover.matches(":popover-open"), true);
    assert.ok(heard.includes(popover[implSymbol]));
  });

  specify("a modal dialog entering and leaving the top layer is heard for the dialog", () => {
    const { document } = page(`<dialog>d</dialog>`);
    const dialog = document.querySelector("dialog");
    const heard = listen();

    dialog.showModal();
    assert.ok(heard.includes(dialog[implSymbol]), "heard on showModal");

    heard.length = 0;
    dialog.close();
    assert.ok(heard.includes(dialog[implSymbol]), "heard on close");
  });

  specify("a listener that throws does not stop the popover from showing", () => {
    const { document } = page(`<div id=p popover>p</div>`);
    const popover = document.getElementById("p");
    setRenderingInvalidation(() => {
      throw new Error("renderer fault");
    });

    popover.showPopover();
    assert.equal(popover.matches(":popover-open"), true);
  });

  specify("nothing installed, a popover shows as before", () => {
    const { document } = page(`<div id=p popover>p</div>`);
    const popover = document.getElementById("p");

    popover.showPopover();
    assert.equal(popover.matches(":popover-open"), true);
  });
});
