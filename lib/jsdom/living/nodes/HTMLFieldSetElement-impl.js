"use strict";
const HTMLCollection = require("../generated/HTMLCollection");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const DefaultConstraintValidationImpl =
  require("../constraint-validation/DefaultConstraintValidation-impl").implementation;
const { formOwner, isListed } = require("../helpers/form-controls");
const { mixin } = require("../../utils");
const { domSymbolTree } = require("../helpers/internal-constants");
const { updateFormAssociatedCustomElementsIn } = require("../helpers/form-associated-custom-elements");

class HTMLFieldSetElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    this._customValidityErrorMessage = "";
  }

  get elements() {
    return HTMLCollection.createImpl(this._globalObject, [], {
      element: this,
      query: () => domSymbolTree.treeToArray(this, { filter: node => node !== this && isListed(node) })
    });
  }

  _attrModified(name, value, oldValue) {
    super._attrModified(name, value, oldValue);

    // The disabled state of the form-associated custom elements it holds follows its own.
    if (name === "disabled") {
      updateFormAssociatedCustomElementsIn(this);
    }
  }

  get form() {
    return formOwner(this);
  }

  get type() {
    return "fieldset";
  }

  _barredFromConstraintValidationSpecialization() {
    return true;
  }
}

mixin(HTMLFieldSetElementImpl.prototype, DefaultConstraintValidationImpl.prototype);

module.exports = {
  implementation: HTMLFieldSetElementImpl
};
