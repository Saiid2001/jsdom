"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

function defineWithInternals(window, name, statics = {}) {
  class Element extends window.HTMLElement {
    constructor() {
      super();
      this.internals = this.attachInternals();
    }
  }
  Object.assign(Element, statics);
  window.customElements.define(name, Element);
  return Element;
}

// https://html.spec.whatwg.org/multipage/custom-elements.html#the-elementinternals-interface
describe("Helpers: ElementInternals", () => {
  specify("ARIA attributes on the internals are the element's own, not its content attributes", () => {
    const { window } = new JSDOM();
    defineWithInternals(window, "x-aria");
    const element = window.document.createElement("x-aria");

    assert.equal(element.internals.role, null);
    element.internals.role = "button";
    element.internals.ariaLabel = "label";
    assert.equal(element.internals.role, "button");
    assert.equal(element.internals.ariaLabel, "label");
    assert.equal(element.getAttribute("role"), null);
    element.internals.role = null;
    assert.equal(element.internals.role, null);
  });

  specify("a form-associated element is listed and submitted with the value its internals set", () => {
    const { window } = new JSDOM(`<form id="f"><x-field name="a"></x-field><x-field></x-field></form>`);
    const { document } = window;
    defineWithInternals(window, "x-field", { formAssociated: true });
    const form = document.getElementById("f");
    const [named, unnamed] = document.querySelectorAll("x-field");

    assert.equal(named.internals.form, form);
    assert.deepEqual([...form.elements], [named, unnamed]);

    named.internals.setFormValue("one");
    assert.deepEqual([...new window.FormData(form)], [["a", "one"]]);

    const data = new window.FormData();
    data.append("b", "two");
    data.append("c", "three");
    unnamed.internals.setFormValue(data);
    assert.deepEqual([...new window.FormData(form)], [["a", "one"], ["b", "two"], ["c", "three"]]);

    named.internals.setFormValue(null);
    unnamed.internals.setFormValue(null);
    assert.deepEqual([...new window.FormData(form)], []);

    named.setAttribute("disabled", "");
    named.internals.setFormValue("one");
    assert.deepEqual([...new window.FormData(form)], []);
  });

  specify("the form callbacks are called as the form owner, reset and disabled state change", () => {
    const { window } = new JSDOM(`<form id="f"></form><fieldset id="fs"></fieldset>`);
    const { document } = window;
    const calls = [];
    class Field extends window.HTMLElement {
      formAssociatedCallback(form) {
        calls.push(["associated", form && form.id]);
      }
      formResetCallback() {
        calls.push(["reset"]);
      }
      formDisabledCallback(disabled) {
        calls.push(["disabled", disabled]);
      }
    }
    Field.formAssociated = true;
    window.customElements.define("x-cb", Field);
    const form = document.getElementById("f");
    const field = document.createElement("x-cb");

    form.appendChild(field);
    assert.deepEqual(calls.splice(0), [["associated", "f"]]);

    form.reset();
    assert.deepEqual(calls.splice(0), [["reset"]]);

    field.setAttribute("disabled", "");
    field.removeAttribute("disabled");
    assert.deepEqual(calls.splice(0), [["disabled", true], ["disabled", false]]);

    document.getElementById("fs").appendChild(field);
    assert.deepEqual(calls.splice(0), [["associated", null]]);

    document.getElementById("fs").disabled = true;
    assert.deepEqual(calls.splice(0), [["disabled", true]]);
  });

  specify("an element upgraded inside a form is told of its form", () => {
    const { window } = new JSDOM(`<form id="f"><x-late></x-late></form>`);
    const calls = [];
    class Late extends window.HTMLElement {
      formAssociatedCallback(form) {
        calls.push(form && form.id);
      }
    }
    Late.formAssociated = true;
    window.customElements.define("x-late", Late);

    assert.deepEqual(calls, ["f"]);
  });

  specify("validity is what setValidity says, and an element that is not form-associated has none of it", () => {
    const { window } = new JSDOM(`<form><x-valid></x-valid></form>`);
    const { document } = window;
    defineWithInternals(window, "x-valid", { formAssociated: true });
    defineWithInternals(window, "x-plain");
    const element = document.querySelector("x-valid");
    const { internals } = element;

    assert.equal(internals.willValidate, true);
    assert.equal(internals.validity.valid, true);
    assert.equal(internals.checkValidity(), true);

    let invalidEvents = 0;
    element.addEventListener("invalid", () => invalidEvents++);
    internals.setValidity({ valueMissing: true }, "fill\r\nme in");
    assert.equal(internals.validity.valid, false);
    assert.equal(internals.validity.valueMissing, true);
    assert.equal(internals.validity.customError, false);
    assert.equal(internals.validationMessage, "fill\nme in");
    assert.equal(internals.checkValidity(), false);
    assert.equal(internals.reportValidity(), false);
    assert.equal(invalidEvents, 2);
    assert.equal(element.closest("form").checkValidity(), false);

    assert.throws(() => internals.setValidity({ customError: true }), window.TypeError || TypeError);
    internals.setValidity({});
    assert.equal(internals.validity.valid, true);
    assert.equal(internals.validationMessage, "");

    const plain = document.createElement("x-plain").internals;
    for (const read of [
      () => plain.form, () => plain.willValidate, () => plain.validity, () => plain.validationMessage,
      () => plain.setFormValue(""), () => plain.setValidity({}), () => plain.checkValidity(),
      () => plain.reportValidity()
    ]) {
      assert.throws(read, error => error.name === "NotSupportedError");
    }
  });

  specify("states is a CustomStateSet of strings", () => {
    const { window } = new JSDOM();
    defineWithInternals(window, "x-states");
    const { states } = window.document.createElement("x-states").internals;

    assert.ok(states instanceof window.CustomStateSet);
    assert.throws(() => new window.CustomStateSet(), TypeError);
    states.add("checked");
    states.add("checked");
    states.add("open");
    assert.equal(states.size, 2);
    assert.equal(states.has("checked"), true);
    assert.deepEqual([...states], ["checked", "open"]);
    assert.equal(states.delete("checked"), true);
    assert.deepEqual([...states.values()], ["open"]);
    states.clear();
    assert.equal(states.size, 0);
  });
});
