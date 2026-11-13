"use strict";
const { userAgentData, HIGH_ENTROPY_HINTS } = require("../helpers/user-agent-data");

function brandList(list) {
  return Object.freeze((list || []).map(({ brand, version }) => ({ brand: String(brand), version: String(version) })));
}

// A fresh copy of a value, so that what one call answers cannot be changed
// through another's.
function copy(value) {
  if (Array.isArray(value)) {
    return value.map(copy);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  }

  return value;
}

// https://wicg.github.io/ua-client-hints/#interface
//
// The provider is read once, when the object is made: the values describe one
// agent for the life of the document.
class NavigatorUADataImpl {
  constructor(globalObject) {
    this._globalObject = globalObject;

    const data = userAgentData() || {};
    this._data = data;
    this._brands = brandList(data.brands);
    this._mobile = Boolean(data.mobile);
    this._platform = String(data.platform ?? "");
  }

  get brands() {
    return this._brands;
  }

  get mobile() {
    return this._mobile;
  }

  get platform() {
    return this._platform;
  }

  _lowEntropyValues() {
    return {
      brands: copy(this._brands),
      mobile: this._mobile,
      platform: this._platform
    };
  }

  // https://wicg.github.io/ua-client-hints/#dom-navigatoruadata-gethighentropyvalues
  // Every hint is answered: the values are constants, the same for every page,
  // so there is nothing a page learns from one that it would not from another.
  getHighEntropyValues(hints) {
    const values = this._lowEntropyValues();

    for (const hint of HIGH_ENTROPY_HINTS) {
      if (hints.includes(hint) && this._data[hint] !== undefined) {
        values[hint] = hint === "fullVersionList" ? copy(brandList(this._data[hint])) : copy(this._data[hint]);
      }
    }

    return Promise.resolve(values);
  }

  toJSON() {
    return this._lowEntropyValues();
  }
}

exports.implementation = NavigatorUADataImpl;
