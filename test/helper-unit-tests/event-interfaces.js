"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

describe("Helpers: event handlers, window.event and event interfaces", () => {
  const { window } = new JSDOM(`<div id="d"></div>`);
  const { document } = window;

  specify("GlobalEventHandlers has the CSS animation, transition, pointer and selection handlers", () => {
    const names = [
      "onanimationstart", "onanimationiteration", "onanimationend", "onanimationcancel",
      "ontransitionrun", "ontransitionstart", "ontransitionend", "ontransitioncancel",
      "ongotpointercapture", "onlostpointercapture", "onpointerdown", "onpointermove", "onpointerup",
      "onpointercancel", "onpointerover", "onpointerout", "onpointerenter", "onpointerleave",
      "onselectstart", "onselectionchange", "oncommand"
    ];
    const div = document.createElement("div");
    for (const name of names) {
      assert.equal(div[name], null, `${name} on an element`);
      assert.equal(window[name], null, `${name} on the window`);
      assert.equal(document[name], null, `${name} on the document`);
      assert.ok(name in window.HTMLElement.prototype, `${name} on HTMLElement.prototype`);
    }
  });

  specify("WindowEventHandlers has onpagereveal and onpageswap, forwarded from the body to the window", () => {
    for (const name of ["onpagereveal", "onpageswap"]) {
      assert.equal(window[name], null, name);
      assert.equal(document.body[name], null, name);
      const handler = () => 0;
      document.body[name] = handler;
      assert.equal(window[name], handler, name);
      window[name] = null;
    }
  });

  specify("an animationend handler set by IDL attribute runs for the event, and not for the prefixed one", () => {
    const div = document.createElement("div");
    let calls = 0;
    div.onanimationend = () => calls++;
    div.dispatchEvent(new window.Event("animationend"));
    assert.equal(calls, 1);
    div.dispatchEvent(new window.Event("webkitAnimationEnd"));
    assert.equal(calls, 1);
  });

  specify("a handler content attribute is compiled for a new event type", () => {
    const { window: w } = new JSDOM(`<div ontransitionend="this.dataset.hit = 'yes'"></div>`, {
      runScripts: "dangerously"
    });
    const div = w.document.querySelector("div");
    div.dispatchEvent(new w.Event("transitionend"));
    assert.equal(div.dataset.hit, "yes");
  });

  specify("window.event is the event during dispatch on a target that is not a node", () => {
    for (const target of [new window.EventTarget(), new window.AbortController().signal]) {
      const event = new window.Event("test");
      let seen;
      target.addEventListener("test", () => {
        seen = window.event;
      });
      target.dispatchEvent(event);
      assert.ok(seen === event, "window.event during dispatch");
      assert.equal(window.event, undefined);
    }
  });

  specify("window.event is not changed by a node's own _document property", () => {
    const div = document.createElement("div");
    div._document = document;
    const event = new window.Event("test");
    let seen;
    div.addEventListener("test", () => {
      seen = window.event;
    });
    div.dispatchEvent(event);
    assert.ok(seen === event);
  });

  specify("window.event is undefined in a listener on a node in a shadow tree", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const inner = document.createElement("span");
    host.attachShadow({ mode: "open" }).append(inner);
    let seen = null;
    inner.addEventListener("test", () => {
      seen = window.event;
    });
    inner.dispatchEvent(new window.Event("test"));
    assert.equal(seen, undefined);
    host.remove();
  });

  specify("createEvent accepts compositionevent, storageevent and textevent", () => {
    for (const [name, iface] of [["CompositionEvent", "CompositionEvent"], ["storageevent", "StorageEvent"],
      ["TextEvent", "TextEvent"]]) {
      const event = document.createEvent(name);
      assert.ok(event instanceof window[iface], name);
    }
  });

  specify("TextEvent has data and initTextEvent", () => {
    const event = document.createEvent("TextEvent");
    event.initTextEvent("textInput", true, false, window, "abc");
    assert.equal(event.type, "textInput");
    assert.equal(event.bubbles, true);
    assert.equal(event.data, "abc");
    assert.throws(() => new window.TextEvent("textInput"), TypeError);
  });

  specify("ToggleEvent is constructed with oldState, newState and source", () => {
    const empty = new window.ToggleEvent("toggle");
    assert.equal(empty.oldState, "");
    assert.equal(empty.newState, "");
    assert.equal(empty.source, null);

    const source = document.createElement("button");
    const event = new window.ToggleEvent("beforetoggle", { oldState: "closed", newState: "open", source,
      cancelable: true });
    assert.ok(event instanceof window.Event);
    assert.equal(event.oldState, "closed");
    assert.equal(event.newState, "open");
    assert.equal(event.source, source);
    assert.equal(event.cancelable, true);
  });

  specify("AnimationEvent and TransitionEvent are constructed from their init dictionaries", () => {
    const a = new window.AnimationEvent("animationend", { animationName: "spin", elapsedTime: 1.5,
      pseudoElement: "::before" });
    assert.equal(a.animationName, "spin");
    assert.equal(a.elapsedTime, 1.5);
    assert.equal(a.pseudoElement, "::before");

    const t = new window.TransitionEvent("transitionend", { propertyName: "width" });
    assert.equal(t.propertyName, "width");
    assert.equal(t.elapsedTime, 0);
    assert.equal(t.pseudoElement, "");
  });
});
