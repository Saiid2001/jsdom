"use strict";
const assert = require("node:assert/strict");
const { describe, specify, before, after } = require("mocha-sugar-free");

const {
  JSDOM, ResourceLoader, setModuleEvaluator, fetchModuleText, createCSSModuleStyleSheet
} = require("../../lib/api.js");

const PAGE = "http://module-element.test/";

// Answers every request with a body of the content type its address ends in.
class Typed extends ResourceLoader {
  fetch(url) {
    const types = { js: "text/javascript", json: "application/json", css: "text/css" };
    const type = types[url.split(".").pop()] || "text/plain";
    const promise = Promise.resolve(Buffer.from(url.endsWith(".json") ? "{}" : "void 0"));
    promise.response = { statusCode: 200, headers: { "content-type": type } };
    promise.abort = () => {};
    return promise;
  }
}

// What each module script does when it runs, by its address; `ran` records the entries the evaluator was handed.
let behaviours = {};
const ran = [];

function evaluator({ source, url, window, fetchText }) {
  const key = source === undefined ? url : source.trim();
  ran.push(key);
  const fetched = source === undefined ? fetchText(url) : Promise.resolve(source);
  return fetched.then(() => () => (behaviours[key] || (() => undefined))(window), error => {
    throw Object.assign(new Error(`Could not read module ${url}`), { fetchFailed: true, cause: error });
  });
}

function load(html) {
  const dom = new JSDOM(html, { url: PAGE, runScripts: "dangerously", resources: new Typed() });
  const loaded = new Promise(resolve => {
    dom.window.addEventListener("load", resolve);
  });
  return { dom, loaded };
}

// https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
// https://html.spec.whatwg.org/multipage/scripting.html#execute-the-script-element
describe("Helpers: the module script element", () => {
  before(() => setModuleEvaluator(evaluator));
  after(() => setModuleEvaluator(null));

  specify("is a module only for a type of exactly \"module\", in any case", async () => {
    ran.length = 0;
    const { loaded } = load(`<body>
      <script type="module">a</script><script type="MODULE">b</script><script type="Module">c</script>
      <script type="module ">d</script><script type=" module">e</script><script type=" module ">f</script>
    </body>`);
    await loaded;
    assert.deepEqual(ran, ["a", "b", "c"]);
  });

  specify("fires load at an external module after it runs, and reports what it threw first", async () => {
    behaviours = {
      [`${PAGE}throws.js`]: () => {
        throw new TypeError("thrown");
      }
    };
    const { dom, loaded } = load(`<body>
      <script type="module" src="throws.js"></script><script type="module" src="fine.js"></script>
    </body>`);
    const events = [];
    dom.window.addEventListener("error", e => {
      events.push(`window:${e.error.message}`);
      e.preventDefault();
    });
    for (const script of dom.window.document.querySelectorAll("script")) {
      script.addEventListener("load", () => events.push(`load:${script.getAttribute("src")}`));
      script.addEventListener("error", () => events.push(`error:${script.getAttribute("src")}`));
    }
    await loaded;
    assert.deepEqual(events, ["window:thrown", "load:throws.js", "load:fine.js"]);
  });

  specify("reports a rejected evaluation after the microtasks the module queued, then fires load", async () => {
    behaviours = {
      [`${PAGE}async.js`]: window => {
        window.queueMicrotask(() => window.log.push("microtask"));
        window.log.push("body");
        return Promise.reject(new Error("rejected"));
      }
    };
    const { dom, loaded } = load(`<body><script type="module" src="async.js"></script></body>`);
    dom.window.log = [];
    dom.window.addEventListener("error", e => {
      dom.window.log.push("global-error");
      e.preventDefault();
    });
    dom.window.document.querySelector("script").addEventListener("load", () => dom.window.log.push("load"));
    await loaded;
    assert.deepEqual(dom.window.log, ["body", "microtask", "global-error", "load"]);
  });

  specify("leaves document.currentScript null while a module runs", async () => {
    let seen;
    behaviours = { [`${PAGE}current.js`]: window => {
      seen = window.document.currentScript;
    } };
    const { loaded } = load(`<body><script type="module" src="current.js"></script></body>`);
    await loaded;
    assert.equal(seen, null);
  });

  specify("does not fire load at an inline module", async () => {
    const { dom, loaded } = load(`<body><script type="module">inline</script></body>`);
    const events = [];
    dom.window.document.querySelector("script").addEventListener("load", () => events.push("load"));
    await loaded;
    assert.deepEqual(events, []);
  });

  specify("refuses a module whose content type is not the type it was asked for", async () => {
    const { dom, loaded } = load(`<body></body>`);
    await loaded;
    await assert.rejects(fetchModuleText(dom.window, `${PAGE}data.json`));
    await assert.rejects(fetchModuleText(dom.window, `${PAGE}code.js`, { type: "json" }));
    await assert.rejects(fetchModuleText(dom.window, `${PAGE}code.js`, { type: "css" }));
    assert.equal(await fetchModuleText(dom.window, `${PAGE}data.json`, { type: "json" }), "{}");
    assert.equal(await fetchModuleText(dom.window, `${PAGE}code.js`), "void 0");
    assert.equal(await fetchModuleText(dom.window, `${PAGE}code.js`, { type: "text" }), "void 0");
  });

  specify("fires error, not load, at a module answered with a type that is not JavaScript", async () => {
    setModuleEvaluator(evaluator);
    const { dom, loaded } = load(`<body><script type="module" src="data.json"></script></body>`);
    const events = [];
    const script = dom.window.document.querySelector("script");
    script.addEventListener("load", () => events.push("load"));
    script.addEventListener("error", () => events.push("error"));
    await loaded;
    assert.deepEqual(events, ["error"]);
  });

  specify("makes a CSS module's style sheet, keeping the rules around one it cannot parse and dropping @import", () => {
    const { window } = new JSDOM(``);
    const sheet = createCSSModuleStyleSheet(
      `@import url("x.css"); #a { color: red; } #b } { color: red; } #c { color: green; }`
    );
    assert.ok(sheet instanceof window.CSSStyleSheet);
    assert.deepEqual(Array.from(sheet.cssRules, rule => rule.selectorText), ["#a", "#c"]);
    assert.equal(createCSSModuleStyleSheet("}}} not css {{{").cssRules.length, 0);
  });

  specify("runs no other module script between one that threw and its load event", async () => {
    behaviours = {
      [`${PAGE}first.js`]: window => {
        window.log.push("first");
        return Promise.reject(new Error("first"));
      },
      [`${PAGE}second.js`]: window => {
        window.log.push("second");
      }
    };
    const { dom, loaded } = load(`<body>
      <script type="module" src="first.js"></script><script type="module" src="second.js" async></script>
    </body>`);
    dom.window.log = [];
    dom.window.addEventListener("error", e => {
      dom.window.log.push("error");
      e.preventDefault();
    });
    for (const script of dom.window.document.querySelectorAll("script")) {
      script.addEventListener("load", () => dom.window.log.push(`load:${script.getAttribute("src")}`));
    }
    await loaded;
    const first = dom.window.log.indexOf("first");
    assert.deepEqual(dom.window.log.slice(first, first + 3), ["first", "error", "load:first.js"]);
  });
});
