"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

function manualTree() {
  const { window } = new JSDOM(`<div id="host"><span id="a"></span><span id="b" slot="s1"></span>text</div>`);
  const { document } = window;
  const host = document.getElementById("host");
  const shadow = host.attachShadow({ mode: "open", slotAssignment: "manual" });
  shadow.innerHTML = `<slot name="s1"></slot><slot name="s2"></slot>`;
  const [s1, s2] = shadow.querySelectorAll("slot");
  return { window, document, host, shadow, s1, s2, a: document.getElementById("a"), b: document.getElementById("b") };
}

// https://html.spec.whatwg.org/multipage/scripting.html#dom-slot-assign
describe("Helpers: imperative slot assignment", () => {
  specify("in a manual shadow root, only what is assigned is slotted, whatever its slot attribute", () => {
    const { s1, a, b } = manualTree();

    assert.deepEqual(s1.assignedNodes(), []);
    assert.equal(b.assignedSlot, null);

    s1.assign(a);
    assert.deepEqual(s1.assignedNodes(), [a]);
    assert.equal(a.assignedSlot, s1);
  });

  specify("assigning moves a node from the slot it was in, and replaces the slot's list", () => {
    const { s1, s2, a, b } = manualTree();

    s1.assign(a, b);
    s2.assign(a);
    assert.deepEqual(s1.assignedNodes(), [b]);
    assert.deepEqual(s2.assignedNodes(), [a]);

    s2.assign();
    assert.deepEqual(s2.assignedNodes(), []);
    assert.equal(a.assignedSlot, null);
  });

  specify("only a child of the host is slotted, and it is once it becomes one", () => {
    const { document, host, s1 } = manualTree();
    const outsider = document.createElement("p");

    s1.assign(outsider);
    assert.deepEqual(s1.assignedNodes(), []);

    host.appendChild(outsider);
    assert.deepEqual(s1.assignedNodes(), [outsider]);

    outsider.remove();
    assert.deepEqual(s1.assignedNodes(), []);
  });

  specify("a text node can be assigned, and the order is the order given", () => {
    const { host, s1, a, b } = manualTree();
    const text = host.lastChild;

    s1.assign(text, b, a);
    assert.deepEqual(s1.assignedNodes(), [text, b, a]);
  });

  specify("assign is on HTMLSlotElement and takes Elements and Texts", () => {
    const { window, s1, document } = manualTree();

    assert.equal(typeof window.HTMLSlotElement.prototype.assign, "function");
    assert.throws(() => s1.assign(document.createComment("c")), window.TypeError || TypeError);
  });

  specify("a named shadow root ignores manual assignment", () => {
    const { window } = new JSDOM(`<div id="host"><span id="a"></span></div>`);
    const host = window.document.getElementById("host");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<slot name="x"></slot><slot></slot>`;
    const [x, fallback] = shadow.querySelectorAll("slot");
    const a = window.document.getElementById("a");

    x.assign(a);
    assert.deepEqual(x.assignedNodes(), []);
    assert.deepEqual(fallback.assignedNodes(), [a]);
  });

  specify("a template reflects its declarative shadow root attributes", () => {
    const { window } = new JSDOM();
    const template = window.document.createElement("template");

    assert.equal(template.shadowRootMode, "");
    assert.equal(template.shadowRootSlotAssignment, "named");
    template.setAttribute("shadowrootmode", "OPEN");
    template.setAttribute("shadowrootslotassignment", "Manual");
    assert.equal(template.shadowRootMode, "open");
    assert.equal(template.shadowRootSlotAssignment, "manual");
    template.setAttribute("shadowrootmode", "bogus");
    template.setAttribute("shadowrootslotassignment", "bogus");
    assert.equal(template.shadowRootMode, "");
    assert.equal(template.shadowRootSlotAssignment, "named");

    template.shadowRootDelegatesFocus = true;
    template.shadowRootClonable = true;
    template.shadowRootSerializable = true;
    assert.ok(template.hasAttribute("shadowrootdelegatesfocus"));
    assert.ok(template.hasAttribute("shadowrootclonable"));
    assert.ok(template.hasAttribute("shadowrootserializable"));
    template.shadowRootMode = "closed";
    assert.equal(template.getAttribute("shadowrootmode"), "closed");
  });
});
