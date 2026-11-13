"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://dom.spec.whatwg.org/#dom-parentnode-movebefore
describe("Helpers: ParentNode.moveBefore()", () => {
  specify("moves a node before the reference child, and to the end for null", () => {
    const { document } = new JSDOM(`<div id=a><i></i><b></b></div><div id=b><span></span></div>`).window;
    const a = document.querySelector("#a");
    const b = document.querySelector("#b");
    const span = b.firstChild;

    a.moveBefore(span, a.lastChild);
    assert.equal(a.innerHTML, "<i></i><span></span><b></b>");

    b.moveBefore(span, null);
    assert.equal(b.innerHTML, "<span></span>");
  });

  specify("treats the node as its own reference child as its next sibling", () => {
    const { document } = new JSDOM(`<div><i></i><b></b></div>`).window;
    const div = document.querySelector("div");
    div.moveBefore(div.firstChild, div.firstChild);
    assert.equal(div.innerHTML, "<i></i><b></b>");
  });

  specify("throws HierarchyRequestError across shadow-including roots", () => {
    const { window } = new JSDOM(`<div></div>`);
    const { document } = window;
    const detached = document.createElement("p");
    assert.throws(() => document.body.moveBefore(detached, null), { name: "HierarchyRequestError" });

    const other = document.createElement("section");
    other.append(detached);
    const doctypeHolder = document.implementation.createHTMLDocument();
    assert.throws(
      () => doctypeHolder.body.moveBefore(document.querySelector("div"), null),
      { name: "HierarchyRequestError" }
    );
  });

  specify("throws for an ancestor, a foreign reference child, and unmovable nodes", () => {
    const { document } = new JSDOM(`<!doctype html><div id=a><p id=c></p></div><div id=b></div>`).window;
    const a = document.querySelector("#a");
    const b = document.querySelector("#b");
    const c = document.querySelector("#c");

    assert.throws(() => c.moveBefore(a, null), { name: "HierarchyRequestError" });
    assert.throws(() => b.moveBefore(a, c), { name: "NotFoundError" });
    assert.throws(() => document.moveBefore(document.doctype, null), { name: "HierarchyRequestError" });
    assert.throws(() => document.moveBefore(document.documentElement, null), { name: "HierarchyRequestError" });
  });

  specify("queues a removal record and an insertion record", async () => {
    const { window } = new JSDOM(`<div id=a><i></i><span></span><b></b></div><div id=b><u></u></div>`);
    const { document } = window;
    const a = document.querySelector("#a");
    const b = document.querySelector("#b");
    const span = document.querySelector("span");
    const records = [];
    const observer = new window.MutationObserver(list => records.push(...list));
    observer.observe(document.body, { childList: true, subtree: true });

    b.moveBefore(span, b.firstChild);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(records.length, 2);
    assert.equal(records[0].target, a);
    assert.deepEqual([...records[0].removedNodes], [span]);
    assert.equal(records[0].previousSibling, document.querySelector("i"));
    assert.equal(records[0].nextSibling, document.querySelector("b"));
    assert.equal(records[1].target, b);
    assert.deepEqual([...records[1].addedNodes], [span]);
    assert.equal(records[1].previousSibling, null);
    assert.equal(records[1].nextSibling, document.querySelector("u"));
  });

  specify("keeps focus, and keeps a style sheet applied", () => {
    const { window } = new JSDOM(`<style>p { color: red }</style><div id=a><input></div><div id=b></div><p></p>`);
    const { document } = window;
    const input = document.querySelector("input");
    input.focus();
    document.querySelector("#b").moveBefore(input, null);
    assert.equal(document.activeElement, input);

    const style = document.querySelector("style");
    document.querySelector("#b").moveBefore(style, null);
    assert.equal(document.styleSheets.length, 1);
    assert.equal(window.getComputedStyle(document.querySelector("p")).color, "rgb(255, 0, 0)");
  });

  specify("updates a live range around the moved node", () => {
    const { document } = new JSDOM(`<div id=a><i></i><span>x</span><b></b></div><div id=b></div>`).window;
    const a = document.querySelector("#a");
    const span = document.querySelector("span");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(a, 3);

    document.querySelector("#b").moveBefore(span, null);
    assert.equal(range.startContainer, a);
    assert.equal(range.startOffset, 1);
    assert.equal(range.endContainer, a);
    assert.equal(range.endOffset, 2);
  });

  specify("calls connectedMoveCallback, or disconnected then connected without one", () => {
    const { window } = new JSDOM(`<div id=a></div><div id=b></div>`);
    const { document } = window;
    const log = [];
    class WithMove extends window.HTMLElement {
      connectedCallback() {
        log.push("connected");
      }
      disconnectedCallback() {
        log.push("disconnected");
      }
      connectedMoveCallback() {
        log.push("move");
      }
    }
    class WithoutMove extends window.HTMLElement {
      connectedCallback() {
        log.push("connected");
      }
      disconnectedCallback() {
        log.push("disconnected");
      }
    }
    window.customElements.define("with-move", WithMove);
    window.customElements.define("without-move", WithoutMove);

    const withMove = document.createElement("with-move");
    const withoutMove = document.createElement("without-move");
    document.querySelector("#a").append(withMove, withoutMove);
    log.length = 0;

    document.querySelector("#b").moveBefore(withMove, null);
    assert.deepEqual(log, ["move"]);
    log.length = 0;

    document.querySelector("#b").moveBefore(withoutMove, null);
    assert.deepEqual(log, ["disconnected", "connected"]);
  });

  specify("keeps a moved subtree observed until its observers are notified", () => {
    const { window } = new JSDOM(`<div id=old><p></p></div><div id=new></div>`);
    const { document } = window;
    const target = document.querySelector("p");
    const observer = new window.MutationObserver(() => {});
    observer.observe(document.querySelector("#old"), { childList: true, subtree: true });

    document.querySelector("#new").moveBefore(target, null);
    target.append(document.createElement("span"));

    const records = observer.takeRecords();
    assert.equal(records.length, 2);
    assert.equal(records[1].target, target);
  });

  specify("resets a select's selectedness once, after an option moves within it", () => {
    const { document } = new JSDOM(`<select><option>A<option>B<option selected>C</select>`).window;
    const select = document.querySelector("select");
    select.moveBefore(select.options[2], select.options[0]);
    assert.equal(select.selectedIndex, 0);
  });

  specify("moves an element's id between the document's map and a shadow root's", () => {
    const { window } = new JSDOM(`<div id=host></div><div id=target></div>`);
    const { document } = window;
    const shadow = document.querySelector("#host").attachShadow({ mode: "open" });
    const target = document.querySelector("#target");

    shadow.moveBefore(target, null);
    assert.equal(document.getElementById("target"), null);
    assert.equal(window.target, undefined);
    assert.equal(shadow.getElementById("target"), target);

    document.body.moveBefore(target, null);
    assert.equal(document.getElementById("target"), target);
    assert.equal(window.target, target);
  });

  specify("finds the first element in tree order with an id after a move", () => {
    const { document } = new JSDOM(`<div id=dup data-a></div><div id=dup data-b></div>`).window;
    const [a, b] = document.querySelectorAll("div");
    document.body.moveBefore(b, a);
    assert.equal(document.getElementById("dup"), b);
  });
});
