"use strict";

const MouseEventImpl = require("./MouseEvent-impl").implementation;

const DragEventInit = require("../generated/DragEventInit");

class DragEventImpl extends MouseEventImpl {}
DragEventImpl.defaultInit = DragEventInit.convert(undefined, undefined);

module.exports = {
  implementation: DragEventImpl
};
