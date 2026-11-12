"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// Only http and https are fetched. The scheme was read off a URL object as
// `scheme`, which it does not have, so every fetch that reached the check --
// any in "cors" or "same-origin" mode -- failed as an unsupported scheme.

async function pageOnServer() {
  const server = await createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end("hello");
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { window } = new JSDOM("", { url, virtualConsole: new VirtualConsole() });

  return { window, url, server };
}

describe("Helpers: fetch modes", () => {
  for (const mode of ["cors", "same-origin"]) {
    specify(`an http fetch in ${mode} mode is sent`, async () => {
      const { window, url, server } = await pageOnServer();

      try {
        const response = await window.fetch(url, { mode });

        assert.equal(response.status, 200);
        assert.equal(await response.text(), "hello");
      } finally {
        window.close();
        server.destroy();
      }
    });
  }
});
