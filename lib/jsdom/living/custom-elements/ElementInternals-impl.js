"use strict";

const DOMException = require("../generated/DOMException");
const FormData = require("../generated/FormData");
const ValidityState = require("../generated/ValidityState");
const { getLabelsForLabelable, formOwner, isDisabled } = require("../helpers/form-controls");
const { isShadowInclusiveAncestor } = require("../helpers/shadow-dom");
const { closest } = require("../helpers/traversal");
const { fireAnEvent } = require("../helpers/events");

const VALIDITY_FLAGS = [
  "valueMissing", "typeMismatch", "patternMismatch", "tooLong", "tooShort",
  "rangeUnderflow", "rangeOverflow", "stepMismatch", "badInput", "customError"
];

// https://infra.spec.whatwg.org/#normalize-newlines
function normalizeNewlines(string) {
  return string.replace(/\r\n?/g, "\n");
}

// A FormData is copied, its entries being the element's from now on; a File or string is kept as it is.
function copyOfSubmissionValue(element, value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (FormData.isImpl(value)) {
    const copy = FormData.createImpl(element._globalObject, []);
    copy._entries = value._entries.map(entry => ({ ...entry }));
    return copy;
  }

  return value;
}

class ElementInternalsImpl {
  constructor(globalObject, args, { targetElement }) {
    this._targetElement = targetElement;
  }

  get shadowRoot() {
    const shadow = this._targetElement._shadowRoot;

    if (!shadow || !shadow._availableToElementInternals) {
      return null;
    }

    return shadow;
  }

  // The element's definition, not its state: internals are attached in the constructor, before the element is
  // custom, and the form API answers from then on.
  _assertFormAssociated(member) {
    if (!this._targetElement._ceDefinition || !this._targetElement._ceDefinition.formAssociated) {
      throw DOMException.create(this._targetElement._globalObject, [
        `Accessing ElementInternals' ${member} is only supported for form-associated custom elements`,
        "NotSupportedError"
      ]);
    }
  }

  get labels() {
    this._assertFormAssociated("labels");

    return getLabelsForLabelable(this._targetElement);
  }

  // https://html.spec.whatwg.org/multipage/custom-elements.html#dom-elementinternals-setformvalue
  setFormValue(value, state = value) {
    this._assertFormAssociated("setFormValue()");

    this._targetElement._faceSubmissionValue = copyOfSubmissionValue(this._targetElement, value);
    this._targetElement._faceState = copyOfSubmissionValue(this._targetElement, state);
  }

  // https://html.spec.whatwg.org/multipage/custom-elements.html#dom-elementinternals-form
  get form() {
    this._assertFormAssociated("form");

    return formOwner(this._targetElement);
  }

  // https://html.spec.whatwg.org/multipage/custom-elements.html#dom-elementinternals-setvalidity
  setValidity(flags, message, anchor) {
    this._assertFormAssociated("setValidity()");

    const anyFlag = VALIDITY_FLAGS.some(flag => flags[flag]);

    if (anyFlag && (message === undefined || message === "")) {
      throw new TypeError("Failed to execute 'setValidity' on 'ElementInternals': " +
        "the second argument should not be empty if one or more flags in the first argument are true.");
    }

    if (anchor !== undefined && anchor !== null && !isShadowInclusiveAncestor(this._targetElement, anchor)) {
      throw DOMException.create(this._targetElement._globalObject, [
        "The validation anchor is not a shadow-including inclusive descendant of the element",
        "NotFoundError"
      ]);
    }

    this._validityFlags = {};
    for (const flag of VALIDITY_FLAGS) {
      this._validityFlags[flag] = Boolean(flags[flag]);
    }

    this._validationMessage = anyFlag ? normalizeNewlines(message) : "";
    this._validationAnchor = anyFlag && anchor ? anchor : null;
  }

  // https://html.spec.whatwg.org/multipage/custom-elements.html#dom-elementinternals-willvalidate
  get willValidate() {
    this._assertFormAssociated("willValidate");

    return this._isCandidateForConstraintValidation();
  }

  get validity() {
    this._assertFormAssociated("validity");

    if (!this._validity) {
      const state = {};
      for (const flag of VALIDITY_FLAGS) {
        state[flag] = () => Boolean(this._validityFlags && this._validityFlags[flag]);
      }
      this._validity = ValidityState.createImpl(this._targetElement._globalObject, [], {
        element: this._targetElement,
        state
      });
    }

    return this._validity;
  }

  get validationMessage() {
    this._assertFormAssociated("validationMessage");

    if (!this._isCandidateForConstraintValidation() || this._satisfiesConstraints()) {
      return "";
    }

    return this._validationMessage ?? "";
  }

  checkValidity() {
    this._assertFormAssociated("checkValidity()");

    if (!this._isCandidateForConstraintValidation() || this._satisfiesConstraints()) {
      return true;
    }

    fireAnEvent("invalid", this._targetElement, undefined, { cancelable: true });
    return false;
  }

  // There is no user to report to, so it is checkValidity.
  reportValidity() {
    this._assertFormAssociated("reportValidity()");

    return this.checkValidity();
  }

  // https://html.spec.whatwg.org/multipage/custom-elements.html#dom-elementinternals-states
  get states() {
    if (!this._states) {
      this._states = this._targetElement._globalObject._createCustomStateSet();
    }

    return this._states;
  }

  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#candidate-for-constraint-validation
  _isCandidateForConstraintValidation() {
    const element = this._targetElement;

    return !isDisabled(element) &&
      !element.hasAttributeNS(null, "readonly") &&
      closest(element, "datalist") === null;
  }

  _satisfiesConstraints() {
    return !this._validityFlags || !VALIDITY_FLAGS.some(flag => this._validityFlags[flag]);
  }

  // https://html.spec.whatwg.org/#reflecting-content-attributes-in-idl-attributes
  _reflectGetTheElement() {
    return this._targetElement;
  }

  // https://html.spec.whatwg.org/multipage/custom-elements.html#internal-content-attribute-map
  // The element's, made when its internals first reflect something.
  get _internalContentAttributeMap() {
    this._targetElement._internalContentAttributeMap ??= new Map();
    return this._targetElement._internalContentAttributeMap;
  }

  _reflectGetTheContentAttribute(reflectedContentAttributeName) {
    return this._internalContentAttributeMap.get(reflectedContentAttributeName) ?? null;
  }

  _reflectSetTheContentAttribute(reflectedContentAttributeName, value) {
    this._internalContentAttributeMap.set(reflectedContentAttributeName, value);
  }

  _reflectDeleteTheContentAttribute(reflectedContentAttributeName) {
    this._internalContentAttributeMap.delete(reflectedContentAttributeName);
  }
}

module.exports = {
  implementation: ElementInternalsImpl
};
