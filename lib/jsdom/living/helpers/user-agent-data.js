"use strict";

// What navigator.userAgentData reports (https://wicg.github.io/ua-client-hints/).
//
// The values are the host application's: this library has no agent of its own to
// describe, and the environment's (a Node process, or the browser the host runs
// in) is not the agent a page is told it is. The provider answers one object with
// the low-entropy values (brands, mobile, platform) and the high-entropy ones
// (architecture, bitness, formFactors, fullVersionList, model, platformVersion,
// uaFullVersion, wow64). None installed, or one answering null, and
// NavigatorUAData and navigator.userAgentData are absent from the window made
// next, as in a browser without them.

let provideData = null;

exports.setUserAgentData = provider => {
  provideData = provider;
};

exports.hasUserAgentData = () => Boolean(provideData && provideData());

exports.userAgentData = () => provideData ? provideData() : null;

// https://wicg.github.io/ua-client-hints/#dictdef-uadatavalues, in the order
// getHighEntropyValues() adds them.
exports.HIGH_ENTROPY_HINTS = [
  "architecture",
  "bitness",
  "formFactors",
  "fullVersionList",
  "model",
  "platformVersion",
  "uaFullVersion",
  "wow64"
];
