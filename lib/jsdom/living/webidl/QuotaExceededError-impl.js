"use strict";
const DOMExceptionImpl = require("./DOMException-impl").implementation;

// https://webidl.spec.whatwg.org/#quotaexceedederror
exports.implementation = class QuotaExceededErrorImpl extends DOMExceptionImpl {
  constructor(globalObject, [message, options = {}]) {
    super(globalObject, [message, "QuotaExceededError"]);

    const { quota, requested } = options;

    if (quota !== undefined && quota < 0) {
      throw new RangeError("Failed to construct 'QuotaExceededError': quota must be at least 0");
    }
    if (requested !== undefined && requested < 0) {
      throw new RangeError("Failed to construct 'QuotaExceededError': requested must be at least 0");
    }
    if (quota !== undefined && requested !== undefined && requested < quota) {
      throw new RangeError("Failed to construct 'QuotaExceededError': requested must be at least quota");
    }

    this.quota = quota === undefined ? null : quota;
    this.requested = requested === undefined ? null : requested;
  }
};

exports.init = require("./DOMException-impl").init;
