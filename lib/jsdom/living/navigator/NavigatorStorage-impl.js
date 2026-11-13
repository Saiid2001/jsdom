"use strict";
const StorageManager = require("../generated/StorageManager");

// https://storage.spec.whatwg.org/#navigatorstorage
exports.implementation = class NavigatorStorageImpl {
  get storage() {
    if (!this._storageManager) {
      this._storageManager = StorageManager.createImpl(this._globalObject);
    }

    return this._storageManager;
  }
};
