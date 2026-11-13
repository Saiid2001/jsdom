"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader } = require("../../lib/api.js");

// document.write() from a parser-inserted script inserts into the parser's input stream at the insertion point, just
// after the script's end tag, and parses it there and then.
// https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#document-write-steps
const PAGE = "http://write.test/";

class Scripts extends ResourceLoader {
  constructor(scripts) {
    super();
    this._scripts = scripts;
  }

  fetch(url) {
    if (this._scripts[url] === undefined) {
      return null;
    }
    let timer;
    const promise = new Promise(resolve => {
      timer = setTimeout(() => resolve(Buffer.from(this._scripts[url])), 20);
    });
    promise.abort = () => clearTimeout(timer);
    return promise;
  }
}

function load(html, scripts = {}) {
  const dom = new JSDOM(html, { url: PAGE, runScripts: "dangerously", resources: new Scripts(scripts) });
  return new Promise(resolve => {
    dom.window.addEventListener("load", () => resolve(dom.window));
  });
}

const W = "_jsdomWindow";

describe("Helpers: document.write() at the insertion point", () => {
  specify("a tag split across two writes is one element, there as soon as the second returns", async () => {
    const window = await load(`<script>
      ${W}.document.write("<");
      ${W}.document.write("i>Filler Text");
      ${W}.seen = ${W}.document.body.firstChild.localName + ":" + ${W}.document.body.firstChild.textContent;
    </script><p>after</p>`);

    assert.equal(window.seen, "i:Filler Text");
  });

  specify("what is written goes before the rest of the document, in the order written", async () => {
    const window = await load(`<body><script>
      ${W}.document.write("<b>1</b>");
      ${W}.document.write("<b>2</b>");
    </script><p>after</p></body>`);

    assert.equal(window.document.body.textContent.replace(/\s+/g, ""), window.document.scripts[0].text
      .replace(/\s+/g, "") + "12after");
  });

  specify("a script written by a script runs before the writer's next write is parsed", async () => {
    const window = await load(`<body><script>
      ${W}.document.write("<script>${W}.document.write('<i>inner</i>')<\\/script>");
      ${W}.document.write("<u>outer</u>");
    </script><p>after</p></body>`);

    const order = Array.from(window.document.body.children, e => e.localName).filter(n => n !== "script");
    assert.deepEqual(order, ["i", "u", "p"]);
  });

  specify("an external parser-blocking script writes just after its own tag", async () => {
    const window = await load(
      `<body><script src="w.js"></script><p>after</p></body>`,
      { [PAGE + "w.js"]: `${W}.document.write("<i>written</i>")` }
    );

    const order = Array.from(window.document.body.children, e => e.localName);
    assert.deepEqual(order, ["script", "i", "p"]);
  });

  specify("an external script a script wrote blocks the parser until it has run", async () => {
    const window = await load(
      `<body><script>${W}.document.write("<script src='late.js'><\\/script><p id=x></p>");</script></body>`,
      { [PAGE + "late.js"]: `${W}.sawX = !!${W}.document.getElementById("x")` }
    );

    assert.equal(window.sawX, false);
    assert.ok(window.document.getElementById("x"));
  });
});
