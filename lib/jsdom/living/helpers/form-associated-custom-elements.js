"use strict";

// https://html.spec.whatwg.org/multipage/custom-elements.html#form-associated-custom-elements
//
// Required lazily: this is reached from the node and form code these modules
// themselves require.

function formControls() {
  return require("./form-controls");
}

function isFormAssociatedCustomElement(element) {
  return element._ceState === "custom" && Boolean(element._ceDefinition && element._ceDefinition.formAssociated);
}

function enqueue(element, callbackName, args) {
  require("./custom-elements").enqueueCECallbackReaction(element, callbackName, args);
}

// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#reset-the-form-owner: the form owner is
// computed when it is asked for (form-controls.js), so what is kept here is the last one the element was told of.
function resetFormOwner(element) {
  const owner = formControls().formOwner(element);
  const previous = element._faceFormOwner ?? null;

  if (owner === previous) {
    return;
  }

  element._faceFormOwner = owner;
  enqueue(element, "formAssociatedCallback", [owner ? require("../generated/utils").wrapperForImpl(owner) : null]);
}

// https://html.spec.whatwg.org/multipage/custom-elements.html#face-disabled
function updateDisabledState(element) {
  const disabled = formControls().isDisabled(element);

  if (disabled === Boolean(element._faceDisabled)) {
    return;
  }

  element._faceDisabled = disabled;
  enqueue(element, "formDisabledCallback", [disabled]);
}

function updateFormAssociatedCustomElement(element) {
  if (isFormAssociatedCustomElement(element)) {
    resetFormOwner(element);
    updateDisabledState(element);
  }
}

// For a subtree inserted, removed, or under a fieldset whose disabled state changed. Only where the window has
// defined a form-associated element at all: the walk is otherwise wasted on every insertion.
function updateFormAssociatedCustomElementsIn(root) {
  if (!root._globalObject || !root._globalObject._formAssociatedCustomElementsDefined) {
    return;
  }

  const { shadowIncludingInclusiveDescendantsIterator } = require("./shadow-dom");

  for (const node of shadowIncludingInclusiveDescendantsIterator(root)) {
    updateFormAssociatedCustomElement(node);
  }
}

module.exports = {
  isFormAssociatedCustomElement,
  resetFormOwner,
  updateDisabledState,
  updateFormAssociatedCustomElement,
  updateFormAssociatedCustomElementsIn
};
