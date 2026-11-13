"use strict";

const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const { processMetaElement } = require("../helpers/referrer-policy");

class HTMLMetaElementImpl extends HTMLElementImpl {
  // https://html.spec.whatwg.org/multipage/semantics.html#meta-referrer
  _attach() {
    super._attach();
    processMetaElement(this);
  }

  _attrModified(name, value, oldValue) {
    super._attrModified(name, value, oldValue);

    if (name === "name" || name === "content") {
      processMetaElement(this);
    }
  }
}

module.exports = {
  implementation: HTMLMetaElementImpl
};
