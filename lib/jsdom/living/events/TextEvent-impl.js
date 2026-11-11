"use strict";

const UIEventImpl = require("./UIEvent-impl").implementation;
const UIEventInit = require("../generated/UIEventInit");

// https://w3c.github.io/uievents/#legacy-interface-TextEvent
// A legacy interface with no constructor: made by document.createEvent("TextEvent").
class TextEventImpl extends UIEventImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);
    this.data = "";
  }

  initTextEvent(type, bubbles, cancelable, view, data) {
    if (this._dispatchFlag) {
      return;
    }

    this.initUIEvent(type, bubbles, cancelable, view, 0);
    this.data = data;
  }
}
TextEventImpl.defaultInit = UIEventInit.convert(undefined, undefined);

module.exports = {
  implementation: TextEventImpl
};
