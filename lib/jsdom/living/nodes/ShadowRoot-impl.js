"use strict";

const { nodeRoot } = require("../helpers/node");
const { mixin } = require("../../utils");

const DocumentFragment = require("./DocumentFragment-impl").implementation;
const DocumentOrShadowRootImpl = require("./DocumentOrShadowRoot-impl").implementation;
const InnerHTMLImpl = require("../domparsing/InnerHTML-impl").implementation;

class ShadowRootImpl extends DocumentFragment {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    const { mode, delegatesFocus = false, slotAssignment = "named", clonable = false, serializable = false } =
      privateData;
    this._mode = mode;
    this._delegatesFocus = delegatesFocus;
    this._slotAssignment = slotAssignment;
    this._clonable = clonable;
    this._serializable = serializable;
    // https://dom.spec.whatwg.org/#shadowroot-declarative
    this._declarative = false;
    this._availableToElementInternals = false;
  }

  _getTheParent(event) {
    if (!event.composed && this === nodeRoot(event._path[0].item)) {
      return null;
    }

    return this._host;
  }

  get mode() {
    return this._mode;
  }

  get delegatesFocus() {
    return this._delegatesFocus;
  }

  get slotAssignment() {
    return this._slotAssignment;
  }

  get clonable() {
    return this._clonable;
  }

  get serializable() {
    return this._serializable;
  }

  get host() {
    return this._host;
  }
}

mixin(ShadowRootImpl.prototype, DocumentOrShadowRootImpl.prototype);
mixin(ShadowRootImpl.prototype, InnerHTMLImpl.prototype);

module.exports = {
  implementation: ShadowRootImpl
};
