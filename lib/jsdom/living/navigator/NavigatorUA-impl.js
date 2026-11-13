"use strict";
const NavigatorUAData = require("../generated/NavigatorUAData");

// https://wicg.github.io/ua-client-hints/#navigatorua
exports.implementation = class NavigatorUAImpl {
  get userAgentData() {
    if (!this._userAgentData) {
      this._userAgentData = NavigatorUAData.createImpl(this._globalObject);
    }

    return this._userAgentData;
  }
};
