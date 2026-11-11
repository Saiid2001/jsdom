"use strict";

const EventImpl = require("./Event-impl").implementation;

const TransitionEventInit = require("../generated/TransitionEventInit");

// https://drafts.csswg.org/css-transitions/#interface-transitionevent
// The interface alone: no CSS transition runs here to fire one.
class TransitionEventImpl extends EventImpl {}
TransitionEventImpl.defaultInit = TransitionEventInit.convert(undefined, undefined);

module.exports = {
  implementation: TransitionEventImpl
};
