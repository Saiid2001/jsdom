"use strict";
const idlUtils = require("../generated/utils");
const { estimateFor } = require("../helpers/storage-usage");

// https://storage.spec.whatwg.org/#storagemanager
//
// Storage is never persistent: no bucket is put in persistent mode, so
// persisted() is false and persist() resolves with what persisted() answers, as
// a browser does when the "persistent-storage" permission is denied.
class StorageManagerImpl {
  constructor(globalObject) {
    this._globalObject = globalObject;
  }

  // https://storage.spec.whatwg.org/#obtain-a-storage-key: an opaque origin has
  // no storage key, and so no shelf.
  _origin() {
    const document = this._globalObject._document;
    const origin = document ? idlUtils.implForWrapper(document)._origin : "null";

    if (origin === "null") {
      throw new this._globalObject.TypeError("This origin has no storage.");
    }

    return origin;
  }

  persisted() {
    try {
      this._origin();
    } catch (error) {
      return Promise.reject(error);
    }

    return Promise.resolve(false);
  }

  persist() {
    return this.persisted();
  }

  estimate() {
    let origin;

    try {
      origin = this._origin();
    } catch (error) {
      return Promise.reject(error);
    }

    return estimateFor(this._globalObject, origin);
  }
}

exports.implementation = StorageManagerImpl;
