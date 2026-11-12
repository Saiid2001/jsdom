"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// innerText, which upstream leaves out: it is the rendered text, where
// textContent is every text node. markgroeningen.de's phone-number script
// reads it, and threw on every page.
// https://html.spec.whatwg.org/multipage/dom.html#dom-innertext

function body(html) {
  return new JSDOM(`<body>${html}</body>`).window.document;
}

describe("Helpers: innerText", () => {
  specify("skips scripts and hidden elements, and breaks lines at blocks and <br>", () => {
    const document = body(`<div id=a>  Hello
   <b>world</b> <script>x=1</script><span hidden>no</span><p>Para</p>tail<br>next</div>`);

    assert.equal(document.getElementById("a").innerText, "Hello world\n\nPara\n\ntail\nnext");
  });

  specify("separates table cells with tabs and rows with newlines", () => {
    const document = body(`<table id=t><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>`);

    assert.equal(document.getElementById("t").innerText, "a\tb\nc");
  });

  specify("keeps the whitespace of preformatted text", () => {
    const document = body(`<pre id=pre>  a\n  b</pre>`);

    assert.equal(document.getElementById("pre").innerText, "  a\n  b");
  });

  specify("is empty for an element that is not rendered", () => {
    const document = body(``);

    assert.equal(document.createElement("div").innerText, "");
  });

  specify("setting it puts the text in, with a <br> for each line break", () => {
    const document = body(``);
    const element = document.createElement("div");

    element.innerText = "x\ny\r\nz";
    assert.equal(element.innerHTML, "x<br>y<br>z");

    element.innerText = null;
    assert.equal(element.innerHTML, "");
  });
});
