"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader } = require("../../lib/api.js");

// Scripts reach the window through `_jsdomWindow`: in node the context holds nothing else, the host application
// being the one that evaluates a script with the window in scope.
const PAGE = "http://parser-pause.test/";

// Serves each script from `scripts` after `delay` ms, so the parser reaches the markup behind it first unless it
// waits.
class DelayedScripts extends ResourceLoader {
  constructor(scripts, delay = 20) {
    super();
    this._scripts = scripts;
    this._delay = delay;
  }

  // A script is its source, or `{ source, delay }` to serve it later or sooner than the rest.
  fetch(url) {
    const entry = this._scripts[url];
    if (entry === undefined) {
      return null;
    }
    const { source, delay } = typeof entry === "string" ? { source: entry, delay: this._delay } : entry;

    let timer;
    const promise = new Promise(resolve => {
      timer = setTimeout(() => resolve(Buffer.from(source)), delay);
    });
    promise.abort = () => clearTimeout(timer);
    return promise;
  }
}

function load(html, scripts) {
  const dom = new JSDOM(html, {
    url: PAGE,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: new DelayedScripts(scripts)
  });

  return new Promise(resolve => {
    dom.window.addEventListener("load", () => resolve(dom.window));
  });
}

const record = expression => `_jsdomWindow.document.documentElement.dataset.seen =
  (_jsdomWindow.document.documentElement.dataset.seen || "") + "[" + (${expression}) + "]";`;

// https://html.spec.whatwg.org/multipage/parsing.html#scriptEndTag
describe("Helpers: the parser waits for a parser-blocking script", () => {
  specify("an external script runs before the markup after it is parsed", async () => {
    const window = await load(`<body><script src="a.js"></script><p id="after"></p></body>`, {
      [PAGE + "a.js"]: record(`!!_jsdomWindow.document.getElementById("after")`)
    });

    assert.equal(window.document.documentElement.dataset.seen, "[false]");
    assert.ok(window.document.getElementById("after"), "the rest of the document is parsed once it has run");
  });

  specify("an inline script behind a pending one sees the document only as far as itself", async () => {
    const window = await load(
      `<body><script src="a.js"></script><p id="one"></p><script>${
        record(`!!_jsdomWindow.document.getElementById("one") + "," + !!_jsdomWindow.document.getElementById("two")`)
      }</script><p id="two"></p></body>`,
      { [PAGE + "a.js"]: record(`"a"`) }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[a][true,false]");
  });

  specify("async and deferred scripts do not hold the parser", async () => {
    const window = await load(
      `<body><script async src="a.js"></script><script defer src="d.js"></script><p id="after"></p></body>`,
      {
        [PAGE + "a.js"]: record(`"async " + !!_jsdomWindow.document.getElementById("after")`),
        [PAGE + "d.js"]: record(`"defer " + !!_jsdomWindow.document.getElementById("after")`)
      }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[async true][defer true]");
  });

  specify("DOMContentLoaded and load come after the whole document is parsed", async () => {
    let atContentLoaded = null;
    const dom = new JSDOM(`<body><script src="a.js"></script><p id="after"></p></body>`, {
      url: PAGE,
      runScripts: "dangerously",
      resources: new DelayedScripts({ [PAGE + "a.js"]: "" })
    });
    dom.window.document.addEventListener("DOMContentLoaded", () => {
      atContentLoaded = Boolean(dom.window.document.getElementById("after"));
    });

    assert.equal(dom.window.document.readyState, "loading");
    await new Promise(resolve => dom.window.addEventListener("load", resolve));
    assert.equal(atContentLoaded, true);
    assert.equal(dom.window.document.readyState, "complete");
  });

  specify("a script waits for the style sheets the parser met before it", async () => {
    const window = await load(
      `<head><link rel="stylesheet" href="s.css"></head><body><p id="t"></p><script>${
        record(`_jsdomWindow.document.styleSheets.length`)
      }</script></body>`,
      { [PAGE + "s.css"]: { source: "#t { position: fixed; }", delay: 60 } }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[1]");
  });

  specify("a customized built-in the parser has a definition for is constructed before the next script runs", async () => {
    const window = await load(
      `<body><script>
        class P extends _jsdomWindow.HTMLParagraphElement { constructor() { super(); this.textContent = "built"; } }
        _jsdomWindow.customElements.define("custom-p", P, { extends: "p" });
      </script><p id="t" is="custom-p"></p><script>${record(`_jsdomWindow.document.getElementById("t").textContent`)}</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[built]");
  });

  specify("a customized built-in whose constructor throws is kept, and the parser carries on", async () => {
    const window = await load(
      `<body><script>
        class V extends _jsdomWindow.HTMLVideoElement { constructor() { super(); throw new Error("no"); } }
        _jsdomWindow.customElements.define("custom-video", V, { extends: "video" });
      </script><video id="t" is="custom-video"><source></video><script>${
        record(`_jsdomWindow.document.getElementById("t").children.length`)
      }</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[1]");
  });

  specify("microtasks a constructor the parser ran queues have run by the next script", async () => {
    const window = await load(
      `<body><script>
        _jsdomWindow.customElements.define("x-0", class extends _jsdomWindow.HTMLElement {
          constructor() { super(); Promise.resolve().then(() => { ${record(`"microtask"`)} }); }
        });
      </script><x-0></x-0><script>${record(`"script"`)}</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[microtask][script]");
  });

  specify("a document cloned while it loads is not loading, and document.write() replaces it", async () => {
    const window = await load(
      `<body><script>{
        const doc = _jsdomWindow.document.cloneNode(true);
        doc.write("<div><template shadowrootmode=open>test</template></div>");
        ${record(`doc.readyState + " " + !!doc.body.firstChild.shadowRoot`)}
      }</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[complete true]");
  });

  specify("the parser runs connectedCallback as it inserts the element", async () => {
    const window = await load(
      `<body><script>
        _jsdomWindow.customElements.define("x-c", class extends _jsdomWindow.HTMLElement {
          connectedCallback() { Promise.resolve().then(() => { ${record(`"connected microtask"`)} }); }
        });
      </script><x-c></x-c><script>${record(`"script"`)}</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[connected microtask][script]");
  });

  specify("microtasks a constructor the parser ran queues run in the order it queued them", async () => {
    const window = await load(
      `<body><script>
        new _jsdomWindow.MutationObserver(() => {}).observe(_jsdomWindow.document.body, { childList: true });
        _jsdomWindow.customElements.define("x-0", class extends _jsdomWindow.HTMLElement {
          constructor() {
            super();
            Promise.resolve().then(() => { ${record(`"promise"`)} });
            const node = _jsdomWindow.document.createTextNode("");
            new _jsdomWindow.MutationObserver(() => { ${record(`"observer"`)} }).observe(node, { characterData: true });
            node.data = "x";
          }
        });
      </script><p></p><x-0></x-0><script>${record(`"script"`)}</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[promise][observer][script]");
  });

  specify("an element defined by a script behind a pending one is created defined", async () => {
    const window = await load(
      `<body><script src="a.js"></script><script>
        class ShadowDisabled extends _jsdomWindow.HTMLElement {
          static get disabledFeatures() { return ["shadow"]; }
        }
        _jsdomWindow.customElements.define("shadow-disabled", ShadowDisabled);
      </script><shadow-disabled><template shadowrootmode="open"><span></span></template></shadow-disabled></body>`,
      { [PAGE + "a.js"]: "" }
    );

    const element = window.document.querySelector("shadow-disabled");
    assert.equal(element.shadowRoot, null, "the declarative root is refused");
    assert.ok(element.querySelector("template"), "and the template stays a template");
  });
});

const insert = (src, async) => `{
  const s = _jsdomWindow.document.createElement("script");
  s.src = "${src}";
  ${async === undefined ? "" : `s.async = ${async};`}
  _jsdomWindow.document.head.appendChild(s);
}`;

// https://html.spec.whatwg.org/multipage/scripting.html#script-processing-model
describe("Helpers: a script added by script", () => {
  specify("is async unless told otherwise, and a parser-created one is not", async () => {
    const window = await load(
      `<body><script>${record(`_jsdomWindow.document.createElement("script").async`)}</script>` +
      `<script>${record(`_jsdomWindow.document.scripts[0].async`)}</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[true][false]");
  });

  specify("does not hold the scripts the parser meets after it", async () => {
    const window = await load(
      `<body><script>${insert("slow.js")}</script><script>${record(`"inline"`)}</script></body>`,
      { [PAGE + "slow.js"]: { source: record(`"slow"`), delay: 60 } }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[inline][slow]");
  });

  specify("runs as soon as it arrives when async, in insertion order when not", async () => {
    const window = await load(
      `<body><script>${insert("a1.js")}${insert("a2.js")}${insert("o1.js", false)}${insert("o2.js", false)}</script>` +
      `<script>${record(`"inline"`)}</script></body>`,
      {
        [PAGE + "a1.js"]: { source: record(`"a1"`), delay: 80 },
        [PAGE + "a2.js"]: { source: record(`"a2"`), delay: 10 },
        [PAGE + "o1.js"]: { source: record(`"o1"`), delay: 120 },
        [PAGE + "o2.js"]: { source: record(`"o2"`), delay: 30 }
      }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[inline][a2][a1][o1][o2]");
  });

  specify("runs once the whole fragment it came in is inserted", async () => {
    const window = await load(
      `<body><div id="c"></div><script>{
        const d = _jsdomWindow.document;
        const frag = d.createDocumentFragment();
        const [one, two, three] = [d.createElement("script"), d.createElement("script"), d.createElement("script")];
        two.id = "movee";
        one.textContent = ${JSON.stringify(record(`"one " + !!_jsdomWindow.document.getElementById("movee")`) + `const m = _jsdomWindow.document.getElementById("movee"); m.parentNode.appendChild(m);`)};
        two.textContent = ${JSON.stringify(record(`"two"`))};
        three.textContent = ${JSON.stringify(record(`"three"`))};
        frag.append(one, two, three);
        d.getElementById("c").appendChild(frag);
      }</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[one true][two][three]");
  });

  specify("runs at once when inline, even while the parser waits for a script", async () => {
    const window = await load(
      `<body><script async src="a.js"></script><script src="slow.js"></script></body>`,
      {
        [PAGE + "slow.js"]: { source: record(`"slow"`), delay: 80 },
        [PAGE + "a.js"]: { source: `{
          const s = _jsdomWindow.document.createElement("script");
          s.textContent = ${JSON.stringify(record(`"inserted"`))};
          _jsdomWindow.document.body.appendChild(s);
          ${record(`"after insert"`)}
        }`, delay: 10 }
      }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[inserted][after insert][slow]");
  });
});

const frame = expression => `_jsdomWindow.requestAnimationFrame(() => { ${record(expression)} });`;

// https://html.spec.whatwg.org/multipage/dom.html#render-blocked
describe("Helpers: animation frames wait for a render-blocked document", () => {
  specify("until the body is parsed", async () => {
    const window = await load(
      `<head><script>${frame(`!!_jsdomWindow.document.body`)}</script><script src="slow.js"></script></head><body></body>`,
      { [PAGE + "slow.js"]: { source: "", delay: 80 } }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[true]");
  });

  specify("until the element a rel=expect link names is parsed", async () => {
    const window = await load(
      `<head><link rel="expect" href="#last" blocking="render"><script>${
        frame(`!!_jsdomWindow.document.getElementById("last")`)
      }</script></head><body><p></p><script src="slow.js"></script><p id="last"></p></body>`,
      { [PAGE + "slow.js"]: { source: "", delay: 80 } }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[true]");
  });

  specify("for a rel=expect link made blocking through its blocking token list", async () => {
    const window = await load(
      `<head><link id="l" rel="expect" href="#last"><script>
        _jsdomWindow.document.getElementById("l").blocking = "render";
        ${frame(`!!_jsdomWindow.document.getElementById("last") + " " + _jsdomWindow.document.getElementById("l").blocking.supports("render")`)}
      </script></head><body><p></p><script src="slow.js"></script><p id="last"></p></body>`,
      { [PAGE + "slow.js"]: { source: "", delay: 80 } }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[true true]");
  });

  specify("not for a rel=expect link added once the body is parsed", async () => {
    const window = await load(
      `<body><link rel="expect" href="#last" blocking="render"><script>${
        frame(`!!_jsdomWindow.document.getElementById("last")`)
      }</script><script src="slow.js"></script><p id="last"></p></body>`,
      { [PAGE + "slow.js"]: { source: "", delay: 80 } }
    );

    assert.equal(window.document.documentElement.dataset.seen, "[false]");
  });
});

// https://html.spec.whatwg.org/multipage/parsing.html#scriptEndTag: "already started" in the fragment case.
describe("Helpers: a script a fragment parser made", () => {
  specify("but a script document.write() writes does run", async () => {
    const window = await load(
      `<body><script>_jsdomWindow.document.write("<script>" + ${JSON.stringify(record(`"written"`))} + "<\\/script>");</script></body>`,
      {}
    );

    assert.equal(window.document.documentElement.dataset.seen, "[written]");
  });

  for (const [name, make] of [
    ["innerHTML", `{ const div = d.createElement("div"); div.innerHTML = "<script>RUN<\\/script>"; return div.firstChild; }`],
    ["an XML fragment", `{
      const x = new _jsdomWindow.DOMParser().parseFromString("<root xmlns='http://www.w3.org/1999/xhtml'/>", "application/xhtml+xml");
      x.documentElement.innerHTML = "<script>RUN<\\/script>";
      return d.importNode(x.documentElement.firstChild, true);
    }`]
  ]) {
    specify(`never runs, nor does its clone, from ${name}`, async () => {
      const window = await load(
        `<body><script>{
          const d = _jsdomWindow.document;
          const script = (() => ${make.replace("RUN", record(`"ran"`).replace(/"/g, "\\\"").replace(/\n/g, " "))})();
          d.body.appendChild(script);
          d.body.appendChild(script.cloneNode(true));
          ${record(`"done"`)}
        }</script></body>`,
        {}
      );

      assert.equal(window.document.documentElement.dataset.seen, "[done]");
    });
  }
});
