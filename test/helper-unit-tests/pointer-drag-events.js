"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

describe("Helpers: PointerEvent, DragEvent, DataTransfer and UIEvent.pseudoTarget", () => {
  const { window } = new JSDOM(`<div id="d"></div>`, { url: "https://example.com/" });
  const { document } = window;

  specify("UIEvent.prototype carries a pseudoTarget getter, inherited by MouseEvent, null on every event", () => {
    const desc = Object.getOwnPropertyDescriptor(window.UIEvent.prototype, "pseudoTarget");
    assert.equal(typeof desc.get, "function");
    assert.equal(Object.getOwnPropertyDescriptor(window.MouseEvent.prototype, "pseudoTarget"), undefined);
    assert.equal(new window.MouseEvent("click").pseudoTarget, null);
  });

  specify("PointerEvent is a MouseEvent with the PointerEventInit defaults", () => {
    const e = new window.PointerEvent("pointerdown", { button: -32768 });
    assert.ok(e instanceof window.MouseEvent);
    assert.equal(e.button, -32768);
    assert.equal(e.pointerId, 0);
    assert.equal(e.width, 1);
    assert.equal(e.height, 1);
    assert.equal(e.pressure, 0);
    assert.equal(e.tiltX, 0);
    assert.equal(e.tiltY, 0);
    assert.equal(e.altitudeAngle, Math.PI / 2);
    assert.equal(e.azimuthAngle, 0);
    assert.equal(e.pointerType, "");
    assert.equal(e.isPrimary, false);
    assert.deepEqual(e.getCoalescedEvents(), []);
    assert.deepEqual(e.getPredictedEvents(), []);
  });

  specify("PointerEvent derives the angles from tilt, and tilt from the angles", () => {
    const fromTilt = new window.PointerEvent("pointermove", { tiltX: 0, tiltY: 90 });
    assert.equal(fromTilt.altitudeAngle, 0);
    assert.equal(fromTilt.azimuthAngle, Math.PI / 2);
    const fromAngles = new window.PointerEvent("pointermove", { altitudeAngle: Math.PI / 4, azimuthAngle: 0 });
    assert.equal(fromAngles.tiltX, 45);
    assert.equal(fromAngles.tiltY, 0);
  });

  specify("PointerEvent keeps the coalesced events it was given", () => {
    const inner = new window.PointerEvent("pointermove");
    const e = new window.PointerEvent("pointermove", { coalescedEvents: [inner] });
    assert.equal(e.getCoalescedEvents()[0], inner);
  });

  specify("element.click() fires an untrusted PointerEvent with pointerId -1 and no pointer type", () => {
    const div = document.getElementById("d");
    let seen;
    div.addEventListener("click", e => {
      seen = e;
    });
    div.click();
    assert.equal(seen.constructor, window.PointerEvent);
    assert.equal(seen.pointerId, -1);
    assert.equal(seen.pointerType, "");
    assert.equal(seen.detail, 0);
    assert.equal(seen.isTrusted, false);
  });

  specify("DragEvent carries a DataTransfer, null by default", () => {
    assert.equal(new window.DragEvent("dragstart", { button: 5 }).button, 5);
    assert.equal(new window.DragEvent("dragstart").dataTransfer, null);
    const dt = new window.DataTransfer();
    assert.equal(new window.DragEvent("drop", { dataTransfer: dt }).dataTransfer, dt);
    assert.throws(() => new window.DragEvent("drop", { dataTransfer: {} }), window.TypeError);
    assert.ok(document.createEvent("DragEvent") instanceof window.DragEvent);
  });

  specify("a constructed DataTransfer is a read/write drag data store", () => {
    const dt = new window.DataTransfer();
    assert.equal(dt.dropEffect, "none");
    assert.equal(dt.effectAllowed, "none");
    dt.dropEffect = "copy";
    dt.dropEffect = "bogus";
    assert.equal(dt.dropEffect, "copy");
    dt.effectAllowed = "copyMove";
    assert.equal(dt.effectAllowed, "copyMove");

    dt.setData("Text", "hello");
    dt.setData("text/uri-list", "https://example.com/");
    assert.deepEqual([...dt.types], ["text/plain", "text/uri-list"]);
    assert.equal(dt.getData("text"), "hello");
    assert.equal(dt.getData("url"), "https://example.com/");
    assert.equal(dt.items.length, 2);
    assert.equal(dt.items[0].kind, "string");
    assert.equal(dt.items[0].type, "text/plain");
    assert.equal(dt.items, dt.items);

    assert.throws(() => dt.items.add("x", "TEXT/PLAIN"), e => e.name === "NotSupportedError");
    assert.equal(dt.items.add("<b>x</b>", "Text/HTML").type, "text/html");
    dt.items.remove(2);

    const file = new window.File(["a"], "a.txt", { type: "text/plain" });
    const item = dt.items.add(file);
    assert.equal(item.kind, "file");
    assert.equal(item.getAsFile(), file);
    assert.equal(dt.files.length, 1);
    assert.equal(dt.files[0], file);
    assert.deepEqual([...dt.types], ["text/plain", "text/uri-list", "Files"]);

    dt.clearData();
    assert.deepEqual([...dt.types], ["Files"]);
    dt.items.clear();
    assert.equal(dt.items.length, 0);
    assert.equal(dt.files.length, 0);
  });

  specify("DataTransferItem.getAsString calls back asynchronously with the data", async () => {
    const dt = new window.DataTransfer();
    dt.setData("text/plain", "hi");
    const value = await new Promise(resolve => {
      dt.items[0].getAsString(resolve);
    });
    assert.equal(value, "hi");
  });
});
