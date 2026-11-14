"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

describe("Helpers: PointerEvent", () => {
  const { window } = new JSDOM(`<div id="d"></div>`, { url: "https://example.com/" });
  const { document } = window;

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
});
