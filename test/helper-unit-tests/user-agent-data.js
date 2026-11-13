"use strict";
const assert = require("node:assert/strict");
const { describe, specify, afterEach } = require("mocha-sugar-free");

const { JSDOM, setUserAgentData } = require("../../lib/api.js");

const DATA = {
  brands: [{ brand: "Chromium", version: "145" }, { brand: "Not=A?Brand", version: "24" }],
  mobile: false,
  platform: "Windows",
  architecture: "x86",
  bitness: "64",
  formFactors: ["Desktop"],
  fullVersionList: [{ brand: "Chromium", version: "145.0.7632.160" }, { brand: "Not=A?Brand", version: "24.0.0.0" }],
  model: "",
  platformVersion: "19.0.0",
  uaFullVersion: "145.0.7632.160",
  wow64: false
};

// https://wicg.github.io/ua-client-hints/#interface
describe("Helpers: NavigatorUAData", () => {
  afterEach(() => setUserAgentData(null));

  specify("is absent without a provider", () => {
    const { window } = new JSDOM("", { url: "https://example.test/" });

    assert.equal("userAgentData" in window.navigator, false);
    assert.equal("NavigatorUAData" in window, false);
  });

  specify("is absent where the provider states no agent", () => {
    setUserAgentData(() => null);
    const { window } = new JSDOM("", { url: "https://example.test/" });

    assert.equal("userAgentData" in window.navigator, false);
    assert.equal("NavigatorUAData" in window, false);
  });

  specify("navigator.userAgentData is one NavigatorUAData per window, in a secure context", () => {
    setUserAgentData(() => DATA);
    const { window } = new JSDOM("", { url: "https://example.test/" });

    assert.ok(window.navigator.userAgentData instanceof window.NavigatorUAData);
    assert.equal(window.navigator.userAgentData, window.navigator.userAgentData);
    assert.throws(() => new window.NavigatorUAData(), window.TypeError);
  });

  specify("an insecure context has the interface but not the attribute", () => {
    setUserAgentData(() => DATA);
    const { window } = new JSDOM("", { url: "http://example.test/" });

    assert.equal("userAgentData" in window.navigator, false);
    assert.equal(typeof window.NavigatorUAData, "function");
  });

  specify("brands, mobile and platform are the provider's low-entropy values", () => {
    setUserAgentData(() => DATA);
    const { userAgentData } = new JSDOM("", { url: "https://example.test/" }).window.navigator;

    assert.deepEqual(JSON.parse(JSON.stringify(userAgentData.brands)), DATA.brands);
    assert.ok(Object.isFrozen(userAgentData.brands));
    assert.equal(userAgentData.brands, userAgentData.brands);
    assert.equal(userAgentData.mobile, false);
    assert.equal(userAgentData.platform, "Windows");
  });

  specify("toJSON() answers the low-entropy values only", () => {
    setUserAgentData(() => DATA);
    const { userAgentData } = new JSDOM("", { url: "https://example.test/" }).window.navigator;

    const json = JSON.parse(JSON.stringify(userAgentData));
    assert.deepEqual(json, { brands: DATA.brands, mobile: false, platform: "Windows" });
  });

  specify("getHighEntropyValues() adds the hints asked for, ignoring unknown ones", async () => {
    setUserAgentData(() => DATA);
    const { userAgentData } = new JSDOM("", { url: "https://example.test/" }).window.navigator;

    const low = await userAgentData.getHighEntropyValues([]);
    assert.deepEqual(Object.keys(low).sort(), ["brands", "mobile", "platform"]);

    const some = await userAgentData.getHighEntropyValues(["wow64", "architecture", "nonsense"]);
    assert.deepEqual(Object.keys(some).sort(), ["architecture", "brands", "mobile", "platform", "wow64"]);
    assert.equal(some.architecture, "x86");
    assert.equal(some.wow64, false);

    const all = await userAgentData.getHighEntropyValues([
      "architecture", "bitness", "formFactors", "fullVersionList", "model",
      "platformVersion", "uaFullVersion", "wow64"
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(all)), JSON.parse(JSON.stringify(DATA)));
  });

  specify("getHighEntropyValues() converts its argument as a sequence<DOMString>", async () => {
    setUserAgentData(() => DATA);
    const { window } = new JSDOM("", { url: "https://example.test/" });

    await assert.rejects(window.navigator.userAgentData.getHighEntropyValues(), window.TypeError);
    await assert.rejects(window.navigator.userAgentData.getHighEntropyValues(5), window.TypeError);
  });
});
