"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// A script is not run in a document that is not fully active: "check if we can
// run script" answers "do not run" for it. A cookie banner that removes an
// embedded player's iframe leaves the iframe's document in flight, and when it
// arrived its scripts ran against a window whose document was gone.
// https://html.spec.whatwg.org/multipage/webappapis.html#check-if-we-can-run-script

async function framedScript() {
  let release;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const server = await createServer(async (req, res) => {
    if (req.url === "/frame.html") {
      await held;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<script>throw new Error("ran");</script>`);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<iframe src="/frame.html"></iframe>`);
    }
  });
  const base = `http://127.0.0.1:${server.address().port}/`;
  // Bare names are the host's to bind, so the script reports that it ran by
  // throwing rather than through the window.
  const runs = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => {
    if (/ran/.test(String(error.message))) {
      runs.push(error);
    }
  });
  const dom = await JSDOM.fromURL(base, {
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole
  });
  const frame = dom.window.document.querySelector("iframe");

  return { dom, frame, release, runs, server };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 100));

describe("Helpers: scripts in a document that is not fully active", () => {
  specify("an iframe document arriving after the iframe is removed runs no script", async () => {
    const { dom, frame, release, runs, server } = await framedScript();

    await settle();
    frame.remove();
    release();
    await settle();

    assert.equal(runs.length, 0);
    dom.window.close();
    server.destroy();
  });

  specify("a script in an iframe still in the page runs", async () => {
    const { dom, release, runs, server } = await framedScript();

    await settle();
    release();
    await settle();

    assert.equal(runs.length, 1);
    dom.window.close();
    server.destroy();
  });
});
