"use strict";

const {
  popoverTargetAssociatedElement,
  setPopoverTargetElement,
  popoverTargetAttributeChanged
} = require("../helpers/popover");

// https://html.spec.whatwg.org/multipage/popover.html#popoverinvokerelement
class PopoverInvokerElementImpl {
  get popoverTargetElement() {
    return popoverTargetAssociatedElement(this);
  }

  set popoverTargetElement(element) {
    setPopoverTargetElement(this, element);
  }

  _attrModifiedPopoverInvokerElement(name) {
    if (name === "popovertarget") {
      popoverTargetAttributeChanged(this);
    }
  }
}

module.exports = {
  implementation: PopoverInvokerElementImpl
};
