"use strict";

const DOMException = require("../generated/DOMException");
const { fireAnEvent } = require("../helpers/events");
const { invalidateStyleCache } = require("../helpers/style-rules");
const {
  isFullyActive,
  isShowing,
  addToTopLayer,
  removeFromTopLayer,
  queueTask,
  queueToggleEventTask,
  fireBeforeToggle,
  hideAllPopoversUntil,
  topmostPopoverAncestor,
  documentState,
  dialogFocusingSteps
} = require("../helpers/popover");

const HTMLElementImpl = require("./HTMLElement-impl").implementation;

// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element
// There is no close watcher: nothing here hears the Escape key, so a dialog closes through close(),
// requestClose() or a form with method=dialog. The modal state is observable through :modal and
// showModal()'s checks; the rest of the document is not made inert.
class HTMLDialogElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    this._returnValue = "";
    this._isModal = false;
    this._previouslyFocusedElement = null;
    this._requestCloseReturnValue = null;
    this._isRunningCancelAction = false;
    this._dialogToggleTaskTracker = null;
  }

  get returnValue() {
    return this._returnValue;
  }

  set returnValue(value) {
    this._returnValue = value;
  }

  // https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-show
  show() {
    if (this.hasAttributeNS(null, "open") && !this._isModal) {
      return;
    }
    if (this.hasAttributeNS(null, "open")) {
      throw DOMException.create(this._globalObject, [
        "The dialog is already open as a modal dialog.",
        "InvalidStateError"
      ]);
    }
    if (!fireBeforeToggle(this, "closed", "open", true, null)) {
      return;
    }
    if (this.hasAttributeNS(null, "open")) {
      return;
    }

    queueToggleEventTask(this, "_dialogToggleTaskTracker", "closed", "open", null);
    this.setAttributeNS(null, "open", "");
    this._previouslyFocusedElement = this._ownerDocument._lastFocusedElement;

    this._hidePopoversBelow();
    dialogFocusingSteps(this);
  }

  // https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-showmodal
  showModal() {
    if (this.hasAttributeNS(null, "open") && this._isModal) {
      return;
    }
    this._throwIfCannotShowModal();

    if (!fireBeforeToggle(this, "closed", "open", true, null)) {
      return;
    }
    if (this.hasAttributeNS(null, "open") || !this.isConnected || isShowing(this) ||
        !isFullyActive(this._ownerDocument)) {
      return;
    }

    queueToggleEventTask(this, "_dialogToggleTaskTracker", "closed", "open", null);
    this.setAttributeNS(null, "open", "");
    this._setModal(true);
    addToTopLayer(this);
    this._previouslyFocusedElement = this._ownerDocument._lastFocusedElement;

    this._hidePopoversBelow();
    dialogFocusingSteps(this);
  }

  _throwIfCannotShowModal() {
    let reason = null;
    if (this.hasAttributeNS(null, "open")) {
      reason = "The dialog is already open.";
    } else if (!this.isConnected) {
      reason = "The dialog is not connected.";
    } else if (isShowing(this)) {
      reason = "The dialog is a showing popover.";
    } else if (!isFullyActive(this._ownerDocument)) {
      reason = "The dialog's document is not fully active.";
    }
    if (reason !== null) {
      throw DOMException.create(this._globalObject, [reason, "InvalidStateError"]);
    }
  }

  // Opening a dialog closes the popovers that are not its ancestors.
  _hidePopoversBelow() {
    const state = documentState(this._ownerDocument);
    let hideUntil = topmostPopoverAncestor(this, state.showingHintPopoverList, null, false);
    if (hideUntil === null) {
      hideUntil = topmostPopoverAncestor(this, state.showingAutoPopoverList, null, false);
    }
    hideAllPopoversUntil(hideUntil || this._ownerDocument, false, true);
  }

  _setModal(value) {
    if (this._isModal !== value) {
      this._isModal = value;
      invalidateStyleCache(this);
    }
  }

  // https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-close
  close(returnValue) {
    this._closeTheDialog(returnValue === undefined ? null : returnValue);
  }

  // https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-requestclose
  // The cancel action of the dialog's close watcher, without the history-action activation it
  // would otherwise need: requestClose() may always be prevented.
  requestClose(returnValue) {
    if (!this.hasAttributeNS(null, "open")) {
      return;
    }
    if (this._isRunningCancelAction) {
      return;
    }
    this._requestCloseReturnValue = returnValue === undefined ? null : returnValue;

    this._isRunningCancelAction = true;
    let shouldContinue;
    try {
      shouldContinue = fireAnEvent("cancel", this, undefined, { cancelable: true });
    } finally {
      this._isRunningCancelAction = false;
    }
    if (!shouldContinue) {
      return;
    }
    this._closeTheDialog(this._requestCloseReturnValue);
  }

  // https://html.spec.whatwg.org/multipage/interactive-elements.html#close-the-dialog
  _closeTheDialog(result) {
    if (!this.hasAttributeNS(null, "open")) {
      return;
    }
    fireBeforeToggle(this, "open", "closed", false, null);
    if (!this.hasAttributeNS(null, "open")) {
      return;
    }
    queueToggleEventTask(this, "_dialogToggleTaskTracker", "open", "closed", null);

    this.removeAttributeNS(null, "open");
    removeFromTopLayer(this);
    const wasModal = this._isModal;
    this._setModal(false);

    if (result !== null) {
      this._returnValue = result;
    }
    this._requestCloseReturnValue = null;

    // With nothing to return focus to, focus inside the dialog is not left there either.
    const element = this._previouslyFocusedElement;
    this._previouslyFocusedElement = null;
    if (element !== null && (wasModal || this._containsFocus())) {
      element.focus();
    } else if (element === null && this._containsFocus()) {
      this._ownerDocument._lastFocusedElement.blur();
    }

    queueTask(() => {
      fireAnEvent("close", this);
    });
  }

  _containsFocus() {
    for (let node = this._ownerDocument._lastFocusedElement; node; node = node.parentNode) {
      if (node === this) {
        return true;
      }
    }
    return false;
  }

  // https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element: the removing
  // steps take the dialog out of the top layer and end its modality, and leave it open.
  _detach() {
    super._detach();

    removeFromTopLayer(this);
    this._setModal(false);
  }
}

module.exports = {
  implementation: HTMLDialogElementImpl
};
