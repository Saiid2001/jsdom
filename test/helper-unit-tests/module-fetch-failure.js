"use strict";
const assert = require("node:assert/strict");
const { describe, specify, before, after } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, setModuleEvaluator } = require("../../lib/api.js");

const PAGE = "http://module-fetch.test/";

// Answers every request with a 404 and a body, the way a server does.
class NotFound extends ResourceLoader {
  fetch() {
    const promise = Promise.resolve(Buffer.from(`{"error": 404}`));
    promise.response = { statusCode: 404, headers: {} };
    promise.abort = () => {};
    return promise;
  }
}

// An evaluator that only fetches its entry, which is all a failed fetch needs, and marks a failure to fetch the way
// the host's does.
function fetchingEvaluator({ source, url, fetchText }) {
  if (source !== undefined) {
    return Promise.resolve(() => {});
  }
  return fetchText(url).then(() => () => {}, error => {
    throw Object.assign(new Error(`Could not read module ${url}`), { fetchFailed: true, cause: error });
  });
}

// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
describe("Helpers: a module script that cannot be fetched", () => {
  before(() => setModuleEvaluator(fetchingEvaluator));
  after(() => setModuleEvaluator(null));

  specify("fires error at its element, not at the window", async () => {
    const dom = new JSDOM(`<body><script type="module" src="missing.js"></script></body>`, {
      url: PAGE,
      runScripts: "dangerously",
      resources: new NotFound()
    });
    const events = [];
    dom.window.addEventListener("error", () => events.push("window"));
    dom.window.document.querySelector("script").addEventListener("error", () => events.push("element"));

    await new Promise(resolve => dom.window.addEventListener("load", resolve));

    assert.deepEqual(events, ["element"]);
  });
});
