"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
// https://html.spec.whatwg.org/multipage/popover.html

function tick(window) {
  return new Promise(resolve => window.setTimeout(resolve, 0));
}

function record(target, types, log) {
  for (const type of types) {
    target.addEventListener(type, e => {
      log.push(e.newState === undefined ? e.type : `${e.type} ${e.oldState}->${e.newState}`);
    });
  }
}

describe("Helpers: dialog", () => {
  specify("show() opens, close() closes and sets returnValue", async () => {
    const { window } = new JSDOM(`<dialog><button id=b>b</button></dialog>`);
    const dialog = window.document.querySelector("dialog");
    const log = [];
    record(dialog, ["beforetoggle", "toggle", "close"], log);

    assert.equal(dialog.returnValue, "");
    dialog.show();
    assert.equal(dialog.open, true);
    assert.equal(window.getComputedStyle(dialog).display, "block");
    assert.deepEqual(log, ["beforetoggle closed->open"]);
    await tick(window);
    assert.deepEqual(log, ["beforetoggle closed->open", "toggle closed->open"]);

    log.length = 0;
    dialog.close("done");
    assert.equal(dialog.open, false);
    assert.equal(dialog.returnValue, "done");
    assert.deepEqual(log, ["beforetoggle open->closed"]);
    await tick(window);
    assert.deepEqual(log, ["beforetoggle open->closed", "toggle open->closed", "close"]);

    dialog.returnValue = "kept";
    dialog.show();
    dialog.close();
    assert.equal(dialog.returnValue, "kept");
    dialog.close("ignored");
    assert.equal(dialog.returnValue, "kept");
  });

  specify("a canceled beforetoggle does not open the dialog", () => {
    const { window } = new JSDOM(`<dialog></dialog>`);
    const dialog = window.document.querySelector("dialog");
    dialog.addEventListener("beforetoggle", e => e.preventDefault());
    dialog.show();
    assert.equal(dialog.open, false);
  });

  specify("toggle events coalesce", async () => {
    const { window } = new JSDOM(`<dialog></dialog>`);
    const dialog = window.document.querySelector("dialog");
    const log = [];
    record(dialog, ["toggle"], log);
    dialog.show();
    dialog.close();
    await tick(window);
    assert.deepEqual(log, ["toggle closed->closed"]);
  });

  specify("showModal() is modal, throws where it cannot open, and focuses the first focusable", () => {
    const { window } = new JSDOM(`<dialog id=a><p>x</p><input id=i1><input id=i2 autofocus></dialog>
      <dialog id=b open></dialog>`);
    const { document } = window;
    const a = document.getElementById("a");
    const b = document.getElementById("b");

    a.showModal();
    assert.equal(a.open, true);
    assert.equal(a.matches(":modal"), true);
    assert.equal(document.activeElement, document.getElementById("i2"));
    a.showModal();
    assert.throws(() => a.show(), e => e.name === "InvalidStateError");
    a.close();
    assert.equal(a.matches(":modal"), false);

    assert.throws(() => b.showModal(), e => e.name === "InvalidStateError");
    b.show();
    assert.equal(b.matches(":modal"), false);

    const detached = document.createElement("dialog");
    assert.throws(() => detached.showModal(), e => e.name === "InvalidStateError");

    const inactive = document.implementation.createHTMLDocument();
    const c = inactive.body.appendChild(inactive.createElement("dialog"));
    assert.throws(() => c.showModal(), e => e.name === "InvalidStateError");
  });

  specify("requestClose() fires cancel once and closes unless canceled", async () => {
    const { window } = new JSDOM(`<dialog></dialog>`);
    const dialog = window.document.querySelector("dialog");
    let cancels = 0;
    dialog.oncancel = e => {
      cancels++;
      dialog.requestClose();
      if (cancels === 1) {
        e.preventDefault();
      }
    };
    dialog.showModal();
    dialog.requestClose("x");
    assert.equal(cancels, 1);
    assert.equal(dialog.open, true);
    dialog.requestClose("y");
    assert.equal(cancels, 2);
    assert.equal(dialog.open, false);
    assert.equal(dialog.returnValue, "y");
  });

  specify("removing a modal dialog leaves it open and fires no close", async () => {
    const { window } = new JSDOM(`<dialog></dialog>`);
    const dialog = window.document.querySelector("dialog");
    dialog.showModal();
    await tick(window);
    let closed = false;
    dialog.addEventListener("close", () => {
      closed = true;
    });
    dialog.remove();
    assert.equal(dialog.open, true);
    assert.equal(dialog.matches(":modal"), false);
    await tick(window);
    assert.equal(closed, false);
  });
});

describe("Helpers: popover", () => {
  specify("showPopover/hidePopover/togglePopover and :popover-open", async () => {
    const { window } = new JSDOM(`<div id=p popover>p</div>`);
    const p = window.document.getElementById("p");
    const log = [];
    record(p, ["beforetoggle", "toggle"], log);

    assert.equal(p.matches(":popover-open"), false);
    p.showPopover();
    assert.equal(p.matches(":popover-open"), true);
    assert.deepEqual(log, ["beforetoggle closed->open"]);
    await tick(window);
    p.hidePopover();
    assert.equal(p.matches(":popover-open"), false);
    await tick(window);
    assert.deepEqual(log, [
      "beforetoggle closed->open", "toggle closed->open", "beforetoggle open->closed", "toggle open->closed"
    ]);

    assert.equal(p.togglePopover(), true);
    assert.equal(p.togglePopover(true), true);
    assert.equal(p.togglePopover(), false);
    assert.equal(p.togglePopover({ force: false }), false);
  });

  specify("validity: no popover attribute, disconnected, inactive document", () => {
    const { window } = new JSDOM(``);
    const { document } = window;
    const div = document.body.appendChild(document.createElement("div"));
    assert.throws(() => div.showPopover(), e => e.name === "NotSupportedError");
    div.popover = "auto";
    div.remove();
    assert.throws(() => div.togglePopover(), e => e.name === "InvalidStateError");
    document.body.append(div);
    div.togglePopover(false);
    div.showPopover();
    div.togglePopover(true);
    div.hidePopover();
    div.hidePopover();

    const inactive = document.implementation.createHTMLDocument();
    const q = inactive.body.appendChild(inactive.createElement("div"));
    q.setAttribute("popover", "");
    assert.throws(() => q.showPopover(), e => e.name === "InvalidStateError");
  });

  specify("auto popovers close each other, manual ones do not", () => {
    const { window } = new JSDOM(`<div id=a popover></div><div id=b popover></div>
      <div id=m popover=manual></div>`);
    const { document } = window;
    const [a, b, m] = ["a", "b", "m"].map(id => document.getElementById(id));
    a.showPopover();
    m.showPopover();
    b.showPopover();
    assert.equal(a.matches(":popover-open"), false);
    assert.equal(b.matches(":popover-open"), true);
    assert.equal(m.matches(":popover-open"), true);
    m.hidePopover();
    assert.equal(b.matches(":popover-open"), true);
  });

  specify("hint popovers stack apart from auto popovers, and close with the auto popover they are in", () => {
    const { window } = new JSDOM(`<div id=a popover><div id=a2 popover></div><div id=h popover=hint></div></div>
      <div id=loose popover=hint></div>`);
    const { document } = window;
    const [a, a2, h, loose] = ["a", "a2", "h", "loose"].map(id => document.getElementById(id));
    const open = el => el.matches(":popover-open");

    a.showPopover();
    a2.showPopover();
    h.showPopover();
    assert.deepEqual([open(a), open(a2), open(h)], [true, true, true]);
    a.hidePopover();
    assert.deepEqual([open(a), open(a2), open(h)], [false, false, false]);

    a.showPopover();
    loose.showPopover();
    assert.deepEqual([open(a), open(loose)], [true, true]);
    a.hidePopover();
    assert.equal(open(loose), true);
    a.showPopover();
    assert.equal(open(loose), false);
  });

  specify("a popover nested through its source stays open, and removal hides both silently", async () => {
    const { window } = new JSDOM(`<div id=parent popover><button id=inv></button></div>
      <div id=child popover></div>`);
    const { document } = window;
    const parent = document.getElementById("parent");
    const child = document.getElementById("child");
    parent.showPopover();
    child.showPopover({ source: document.getElementById("inv") });
    assert.equal(parent.matches(":popover-open"), true);
    assert.equal(child.matches(":popover-open"), true);
    await tick(window);

    const log = [];
    record(parent, ["beforetoggle", "toggle"], log);
    record(child, ["beforetoggle", "toggle"], log);
    parent.remove();
    assert.equal(parent.matches(":popover-open"), false);
    assert.equal(child.matches(":popover-open"), false);
    await tick(window);
    assert.deepEqual(log, []);
  });

  specify("changing the popover attribute's state hides a showing popover", () => {
    const { window } = new JSDOM(`<div id=p popover></div>`);
    const p = window.document.getElementById("p");
    p.showPopover();
    p.popover = "manual";
    assert.equal(p.matches(":popover-open"), false);
  });

  specify("popovertarget buttons toggle their target, with the button as source", async () => {
    const { window } = new JSDOM(`<button id=b popovertarget=p></button>
      <button id=h popovertarget=p popovertargetaction=hide></button><div id=p popover></div>`);
    const { document } = window;
    const b = document.getElementById("b");
    const p = document.getElementById("p");
    const sources = [];
    p.addEventListener("beforetoggle", e => sources.push(e.source));

    assert.equal(b.popoverTargetElement, p);
    assert.equal(b.popoverTargetAction, "toggle");
    b.click();
    assert.equal(p.matches(":popover-open"), true);
    document.getElementById("h").click();
    assert.equal(p.matches(":popover-open"), false);
    assert.deepEqual(sources, [b, document.getElementById("h")]);

    b.popoverTargetElement = null;
    assert.equal(b.hasAttribute("popovertarget"), false);
    b.popoverTargetElement = p;
    assert.equal(b.getAttribute("popovertarget"), "");
    assert.equal(b.popoverTargetElement, p);
    b.setAttribute("popovertarget", "nope");
    assert.equal(b.popoverTargetElement, null);
  });
});
