"use strict";

const EventImpl = require("./Event-impl").implementation;

const AnimationEventInit = require("../generated/AnimationEventInit");

// https://drafts.csswg.org/css-animations/#interface-animationevent
// The interface alone: no CSS animation runs here to fire one.
class AnimationEventImpl extends EventImpl {}
AnimationEventImpl.defaultInit = AnimationEventInit.convert(undefined, undefined);

module.exports = {
  implementation: AnimationEventImpl
};
