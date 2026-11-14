"use strict";

const reportException = require("../helpers/runtime-script-errors");

// https://html.spec.whatwg.org/multipage/dnd.html#the-datatransferitem-interface
// An item is disabled once it is no longer in its drag data store: it then reports an empty kind and type and
// gives up no data.
class DataTransferItemImpl {
  constructor(globalObject, args, { item, store }) {
    this._globalObject = globalObject;
    this._item = item;
    this._store = store;
  }

  get _enabled() {
    return this._store.items.includes(this._item);
  }

  get kind() {
    return this._enabled ? this._item.kind : "";
  }

  get type() {
    return this._enabled ? this._item.type : "";
  }

  getAsString(callback) {
    if (callback === null || !this._enabled || this._item.kind !== "string") {
      return;
    }
    const { data } = this._item;
    setTimeout(() => {
      try {
        callback(data);
      } catch (error) {
        reportException(this._globalObject, error);
      }
    }, 0);
  }

  getAsFile() {
    if (!this._enabled || this._item.kind !== "file") {
      return null;
    }
    return this._item.data;
  }
}

module.exports = {
  implementation: DataTransferItemImpl
};
