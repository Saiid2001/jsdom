"use strict";
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const DefaultConstraintValidationImpl =
  require("../constraint-validation/DefaultConstraintValidation-impl").implementation;
const { mixin } = require("../../utils");
const { isDisabled, formOwner, getLabelsForLabelable, reflectedFormActionURL } = require("../helpers/form-controls");
const { asciiLowercase } = require("../helpers/strings");

class HTMLButtonElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    this._customValidityErrorMessage = "";
    this._labels = null;

    this._hasActivationBehavior = true;
  }

  _activationBehavior() {
    const { form } = this;
    if (form && !isDisabled(this)) {
      if (this.type === "submit") {
        form._doRequestSubmit(this);
      }
      if (this.type === "reset") {
        form._doReset();
      }
    }
  }

  _getValue() {
    const valueAttr = this.getAttributeNS(null, "value");
    return valueAttr === null ? "" : valueAttr;
  }

  get labels() {
    return getLabelsForLabelable(this);
  }

  get form() {
    return formOwner(this);
  }

  get type() {
    const typeAttr = asciiLowercase(this.getAttributeNS(null, "type") || "");
    switch (typeAttr) {
      case "submit":
      case "reset":
      case "button":
        return typeAttr;
      default:
        return "submit";
    }
  }

  get formAction() {
    return reflectedFormActionURL(this, "formaction");
  }

  set formAction(value) {
    this.setAttributeNS(null, "formaction", value);
  }

  set type(v) {
    this.setAttributeNS(null, "type", v);
  }

  _barredFromConstraintValidationSpecialization() {
    return this.type === "reset" || this.type === "button";
  }
}

mixin(HTMLButtonElementImpl.prototype, DefaultConstraintValidationImpl.prototype);

module.exports = {
  implementation: HTMLButtonElementImpl
};
