"use strict";

const idlUtils = require("../generated/utils");
const DOMException = require("../generated/DOMException");
const DataTransferItem = require("../generated/DataTransferItem");
const { asciiLowercase } = require("../helpers/strings");

// https://html.spec.whatwg.org/multipage/dnd.html#the-datatransferitemlist-interface
// A view of its DataTransfer's drag data store. Each store item keeps the one DataTransferItem made for it.
class DataTransferItemListImpl {
  constructor(globalObject, args, { dataTransfer }) {
    this._globalObject = globalObject;
    this._dataTransfer = dataTransfer;
  }

  get _store() {
    return this._dataTransfer._store;
  }

  get length() {
    return this._store.items.length;
  }

  get [idlUtils.supportedPropertyIndices]() {
    return this._store.items.keys();
  }

  [idlUtils.supportsPropertyIndex](index) {
    return index < this._store.items.length;
  }

  [idlUtils.indexedGet](index) {
    const item = this._store.items[index];
    if (!item) {
      return null;
    }
    item.object ||= DataTransferItem.createImpl(this._globalObject, [], { item, store: this._store });
    return item.object;
  }

  add(data, type) {
    if (this._store.mode !== "read/write") {
      return null;
    }

    let item;
    if (typeof data === "string") {
      const lowerType = asciiLowercase(type);
      if (this._store.items.some(i => i.kind === "string" && i.type === lowerType)) {
        throw DOMException.create(this._globalObject, [
          `An item of kind "string" and type "${lowerType}" is already in the list.`,
          "NotSupportedError"
        ]);
      }
      item = { kind: "string", type: lowerType, data };
    } else {
      item = { kind: "file", type: asciiLowercase(data.type), data };
    }

    this._store.items.push(item);
    this._dataTransfer._storeChanged();
    return this[idlUtils.indexedGet](this._store.items.length - 1);
  }

  remove(index) {
    if (this._store.mode !== "read/write") {
      throw DOMException.create(this._globalObject, [
        "The drag data store is not in read/write mode.",
        "InvalidStateError"
      ]);
    }
    if (index >= this._store.items.length) {
      return;
    }
    this._store.items.splice(index, 1);
    this._dataTransfer._storeChanged();
  }

  clear() {
    if (this._store.mode !== "read/write") {
      return;
    }
    this._store.items = [];
    this._dataTransfer._storeChanged();
  }
}

module.exports = {
  implementation: DataTransferItemListImpl
};
