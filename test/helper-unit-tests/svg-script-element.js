"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// An SVG script element is prepared and run the way an HTML one is: its source
// is its href attribute (or xlink:href) instead of src, and the rest of the
// processing model is the same, in an SVG document and in foreign content.
// https://svgwg.org/svg2-draft/interact.html#ScriptElement
// https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inforeign

const SVG_NS = "http://www.w3.org/2000/svg";

// Bare names are the host's to bind, so a script reports that it ran by
// throwing; the messages are collected in the order the scripts ran.
function recorder() {
  const ran = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => {
    const match = /ran:([^\]]*)/.exec(String(error.message));
    if (match) {
      ran.push(match[1]);
    }
  });
  return { ran, virtualConsole };
}

function loaded(window) {
  return new Promise(resolve => {
    window.addEventListener("load", resolve);
  });
}

describe("Helpers: the SVG script element", () => {
  specify("is an SVGScriptElement with a reflected type", () => {
    const { window } = new JSDOM(``);
    const script = window.document.createElementNS(SVG_NS, "script");

    assert.ok(script instanceof window.SVGScriptElement);
    assert.ok(script instanceof window.SVGElement);
    script.type = "module";
    assert.equal(script.getAttribute("type"), "module");
  });

  specify("runs inline in an SVG document, in document order with HTML scripts", () => {
    const { ran, virtualConsole } = recorder();
    const dom = new JSDOM(
      `<svg xmlns="${SVG_NS}" xmlns:h="http://www.w3.org/1999/xhtml">` +
      `<h:script>throw new Error("ran:html")</h:script>` +
      `<script><![CDATA[throw new Error("ran:svg")]]></script>` +
      `</svg>`,
      { contentType: "image/svg+xml", runScripts: "dangerously", virtualConsole }
    );
    assert.ok(dom.window);
    assert.deepEqual(ran, ["html", "svg"]);
  });

  specify("runs inline in an svg element in an HTML document", () => {
    const { ran, virtualConsole } = recorder();
    const dom = new JSDOM(
      `<!DOCTYPE html><svg><script>throw new Error("ran:svg")</script></svg>` +
      `<script>throw new Error("ran:html")</script>`,
      { runScripts: "dangerously", virtualConsole }
    );
    assert.ok(dom.window);
    assert.deepEqual(ran, ["svg", "html"]);
  });

  specify("does not run a script of a type that is not JavaScript", () => {
    const { ran, virtualConsole } = recorder();
    const dom = new JSDOM(
      `<svg xmlns="${SVG_NS}"><script type="text/plain">throw new Error("ran:plain")</script></svg>`,
      { contentType: "image/svg+xml", runScripts: "dangerously", virtualConsole }
    );
    assert.ok(dom.window);
    assert.deepEqual(ran, []);
  });

  specify("fetches and runs its href, and fires load; a missing one fires error", async () => {
    const server = await createServer((req, res) => {
      if (req.url === "/a.js" || req.url === "/b.js") {
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(`throw new Error("ran:${req.url}")`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    try {
      const { ran, virtualConsole } = recorder();
      const base = `http://127.0.0.1:${server.address().port}/`;
      const { window } = new JSDOM(
        `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink">` +
        `<script href="/a.js"/><script xlink:href="/b.js"/></svg>`,
        { url: base, contentType: "image/svg+xml", runScripts: "dangerously", resources: "usable", virtualConsole }
      );
      await loaded(window);
      assert.deepEqual(ran, ["/a.js", "/b.js"]);

      const events = [];
      const svg = window.document.documentElement;
      for (const href of ["/a.js", "/missing.js"]) {
        const script = window.document.createElementNS(SVG_NS, "script");
        const settled = new Promise(resolve => {
          script.addEventListener("load", () => resolve(`load ${href}`));
          script.addEventListener("error", () => resolve(`error ${href}`));
        });
        svg.appendChild(script).setAttribute("href", href);
        events.push(await settled);
      }

      assert.deepEqual(events, ["load /a.js", "error /missing.js"]);
    } finally {
      server.destroy();
    }
  });
});
