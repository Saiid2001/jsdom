"use strict";

const DOMException = require("../generated/DOMException");
const { fireAnEvent } = require("../helpers/events");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;

// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
//
// A modal dialog is drawn fixed over the viewport (presentational-hints.js),
// which stands in for the top layer. Nothing outside it is made inert, and it
// is not closed by the Escape key.
class HTMLDialogElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    this._returnValue = "";
    this._isModal = false;
  }

  get returnValue() {
    return this._returnValue;
  }

  set returnValue(value) {
    this._returnValue = value;
  }

  show() {
    if (this.hasAttributeNS(null, "open")) {
      if (!this._isModal) {
        return;
      }

      throw this._invalidState("The dialog is already open as a modal dialog.");
    }

    this.setAttributeNS(null, "open", "");
  }

  showModal() {
    if (this.hasAttributeNS(null, "open")) {
      if (this._isModal) {
        return;
      }

      throw this._invalidState("The dialog is already open as a non-modal dialog.");
    }

    if (!this.isConnected) {
      throw this._invalidState("The dialog is not in a document.");
    }

    // Before the attribute, whose change restyles the element.
    this._isModal = true;
    this.setAttributeNS(null, "open", "");
  }

  close(returnValue) {
    this._close(returnValue === undefined ? null : returnValue);
  }

  // https://html.spec.whatwg.org/multipage/interactive-elements.html#close-the-dialog
  _close(result) {
    if (!this.hasAttributeNS(null, "open")) {
      return;
    }

    this._isModal = false;
    this.removeAttributeNS(null, "open");

    if (result !== null) {
      this._returnValue = result;
    }

    setTimeout(() => fireAnEvent("close", this), 0);
  }

  _attrModified(name, value, oldValue) {
    if (name === "open" && value === null) {
      this._isModal = false;
    }

    super._attrModified(name, value, oldValue);
  }

  _invalidState(message) {
    return DOMException.create(this._globalObject, [message, "InvalidStateError"]);
  }
}

module.exports = {
  implementation: HTMLDialogElementImpl
};
