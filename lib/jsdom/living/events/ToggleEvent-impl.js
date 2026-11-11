"use strict";

const EventImpl = require("./Event-impl").implementation;
const idlUtils = require("../generated/utils");
const { retarget } = require("../helpers/shadow-dom");

const ToggleEventInit = require("../generated/ToggleEventInit");

// https://html.spec.whatwg.org/multipage/interaction.html#the-toggleevent-interface
// The interface alone: nothing fires a ToggleEvent, since no popover or dialog toggles here.
class ToggleEventImpl extends EventImpl {
  // https://html.spec.whatwg.org/multipage/interaction.html#dom-toggleevent-source
  get source() {
    if (this._source === null) {
      return null;
    }
    return retarget(this._source, idlUtils.implForWrapper(this.currentTarget));
  }

  // Written once, by the constructor from the init dictionary.
  set source(value) {
    this._source = value;
  }
}
ToggleEventImpl.defaultInit = ToggleEventInit.convert(undefined, undefined);

module.exports = {
  implementation: ToggleEventImpl
};
