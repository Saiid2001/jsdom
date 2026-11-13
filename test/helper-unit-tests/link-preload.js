"use strict";
const assert = require("node:assert/strict");
const { describe, specify, before, after } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole, setModulePreloader, fetchModuleText } = require("../../lib/api.js");

// <link rel=preload> and <link rel=modulepreload>.
// https://html.spec.whatwg.org/multipage/links.html#link-type-preload
// https://html.spec.whatwg.org/multipage/links.html#link-type-modulepreload
// https://fetch.spec.whatwg.org/#concept-request-preload-key

const PAGE = "http://example.test/page.html";

const BODIES = {
  css: { type: "text/css", body: "#t { color: rgb(255, 0, 0); }" },
  js: { type: "text/javascript", body: "void 0;" },
  png: { type: "image/png", body: "not really a png" },
  ttf: { type: "font/ttf", body: "\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000" },
  xml: { type: "text/xml", body: "<root>Text.me</root>" }
};

/**
 * Answers from memory, by the extension of the path, and counts what it is
 * asked for. A path containing "missing" is answered 404; one containing
 * "unreachable" fails as a network error; one containing "pending" never
 * settles. `?acao` answers with Access-Control-Allow-Origin: *.
 */
class Counting extends ResourceLoader {
  constructor() {
    super();
    this.asked = [];
  }

  count(url) {
    return this.asked.filter(entry => entry.url === url).length;
  }

  fetch(url, options = {}) {
    this.asked.push({ url, options });

    const parsed = new URL(url);
    const extension = parsed.pathname.split(".").pop();
    const { type, body } = BODIES[extension] || { type: "text/plain", body: "text" };
    let request;

    if (parsed.pathname.includes("unreachable")) {
      request = Promise.reject(new Error("unreachable"));
      request.catch(() => {});
    } else if (parsed.pathname.includes("pending")) {
      request = new Promise(() => {});
    } else {
      request = Promise.resolve(Buffer.from(body));
    }

    const headers = { "content-type": type };
    if (parsed.searchParams.has("acao")) {
      headers["access-control-allow-origin"] = "*";
    }
    const statusCode = parsed.pathname.includes("missing") ? 404 : 200;

    request.response = { statusCode, statusMessage: statusCode === 200 ? "OK" : "Not Found", headers };
    request.href = url;
    request.abort = () => {};
    request.getHeader = name => headers[name.toLowerCase()] ?? null;

    return request;
  }
}

function open(html = "", { runScripts } = {}) {
  const loader = new Counting();
  const dom = new JSDOM(`<!DOCTYPE html><html><head>${html}</head><body><p id="t"></p></body></html>`, {
    url: PAGE,
    resources: loader,
    runScripts,
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  });
  const loaded = new Promise(resolve => {
    dom.window.addEventListener("load", resolve);
  });
  return { window: dom.window, document: dom.window.document, loader, loaded };
}

function preloadLink(document, attributes) {
  const link = document.createElement("link");
  link.rel = "preload";
  for (const [name, value] of Object.entries(attributes)) {
    link.setAttribute(name, value);
  }
  return link;
}

/** "load", "error", or "none" when neither fires within `ms`. */
function eventOf(element, ms = 200) {
  return new Promise(resolve => {
    element.addEventListener("load", () => resolve("load"));
    element.addEventListener("error", () => resolve("error"));
    setTimeout(() => resolve("none"), ms);
  });
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

describe("Helpers: link rel=preload", () => {
  specify("relList supports preload and modulepreload, and none of the hints that fetch nothing", () => {
    const { document } = open();
    const link = document.createElement("link");
    assert.equal(link.relList.supports("preload"), true);
    assert.equal(link.relList.supports("modulepreload"), true);
    assert.equal(link.relList.supports("stylesheet"), true);
    assert.equal(link.relList.supports("prefetch"), false);
    assert.equal(link.relList.supports("preconnect"), false);
    assert.equal(link.relList.supports("dns-prefetch"), false);
  });

  specify("as reflects json and text along with the other destinations", () => {
    const { document } = open();
    const link = document.createElement("link");
    for (const [value, reflected] of [["json", "json"], ["text", "text"], ["foNt", "font"], ["images", ""]]) {
      link.as = value;
      assert.equal(link.as, reflected);
    }
  });

  for (const [as, path] of [["style", "/a.css"], ["script", "/a.js"], ["image", "/a.png"], ["fetch", "/a.xml"],
    ["font", "/a.ttf"], ["track", "/a.vtt"]]) {
    specify(`as=${as} is fetched once and fires load`, async () => {
      const { document, loader } = open();
      const link = preloadLink(document, { as, href: path });
      const event = eventOf(link);
      document.head.append(link);
      assert.equal(await event, "load");
      assert.equal(loader.count(`http://example.test${path}`), 1);
    });
  }

  for (const as of ["", "foobar", "audio", "video", "json", "text", "document", "iframe"]) {
    specify(`as="${as}" fetches nothing and fires nothing`, async () => {
      const { document, loader } = open();
      const link = preloadLink(document, { as, href: "/a.xml" });
      const event = eventOf(link);
      document.head.append(link);
      assert.equal(await event, "none");
      assert.equal(loader.count("http://example.test/a.xml"), 0);
    });
  }

  specify("a type the destination does not support is not fetched", async () => {
    const { document, loader } = open();
    for (const [as, type, path] of [["style", "text/plain", "/a.css"], ["image", "image/unknown", "/a.png"],
      ["script", "text/not-javascript", "/a.js"], ["font", "font/not-a-font", "/a.ttf"], ["image", "garbage", "/b.png"]]) {
      const link = preloadLink(document, { as, type, href: path });
      document.head.append(link);
    }
    await wait(50);
    assert.equal(loader.asked.length, 0);

    for (const [as, type, path] of [["style", "text/css", "/c.css"], ["image", "image/png", "/c.png"],
      ["script", "application/javascript", "/c.js"], ["font", "font/otf", "/c.ttf"], ["track", "text/vtt", "/c.vtt"]]) {
      const link = preloadLink(document, { as, type, href: path });
      document.head.append(link);
    }
    await wait(50);
    assert.equal(loader.asked.length, 5);
  });

  specify("media that does not match is not fetched", async () => {
    const { document, loader } = open();
    document.head.append(preloadLink(document, { as: "style", media: "print", href: "/print.css" }));
    document.head.append(preloadLink(document, { as: "style", media: "screen", href: "/screen.css" }));
    await wait(50);
    assert.equal(loader.count("http://example.test/print.css"), 0);
    assert.equal(loader.count("http://example.test/screen.css"), 1);
  });

  specify("a 404 is a response, and fires load; a network error fires error", async () => {
    const { document } = open();
    const missing = preloadLink(document, { as: "script", href: "/missing.js" });
    const unreachable = preloadLink(document, { as: "script", href: "/unreachable.js" });
    const events = [eventOf(missing), eventOf(unreachable)];
    document.head.append(missing, unreachable);
    assert.deepEqual(await Promise.all(events), ["load", "error"]);
  });

  specify("a cross-origin cors preload the site does not share is a network error", async () => {
    const { document } = open();
    const refused = preloadLink(document, { as: "fetch", crossorigin: "", href: "http://other.test/a.xml" });
    const shared = preloadLink(document, { as: "fetch", crossorigin: "", href: "http://other.test/a.xml?acao" });
    const opaque = preloadLink(document, { as: "image", href: "http://other.test/a.png" });
    const events = [eventOf(refused), eventOf(shared), eventOf(opaque)];
    document.head.append(refused, shared, opaque);
    assert.deepEqual(await Promise.all(events), ["error", "load", "load"]);
  });

  specify("a cors preload states its origin", async () => {
    const { document, loader } = open();
    const link = preloadLink(document, { as: "fetch", crossorigin: "", href: "http://other.test/a.xml?acao" });
    const event = eventOf(link);
    document.head.append(link);
    await event;
    assert.equal(loader.asked[0].options.additionalHeaders.Origin, "http://example.test");
  });

  specify("is fetched only once connected to a document with a browsing context", async () => {
    const { window, document, loader } = open();
    const detached = preloadLink(document, { as: "image", href: "/detached.png" });
    const fragment = document.createDocumentFragment();
    fragment.append(preloadLink(document, { as: "image", href: "/fragment.png" }));
    const inert = document.implementation.createHTMLDocument("");
    inert.head.append(preloadLink(inert, { as: "image", href: "/inert.png" }));
    await wait(50);
    assert.equal(loader.asked.length, 0);

    document.head.append(fragment);
    await wait(50);
    assert.equal(loader.count("http://example.test/fragment.png"), 1);
    assert.equal(window.document, document);
  });

  specify("changing href fetches the new address", async () => {
    const { document, loader } = open();
    const link = preloadLink(document, { as: "style", href: "/one.css" });
    document.head.append(link);
    await wait(20);
    link.href = "/two.css";
    const event = eventOf(link);
    assert.equal(await event, "load");
    assert.equal(loader.count("http://example.test/one.css"), 1);
    assert.equal(loader.count("http://example.test/two.css"), 1);
  });

  specify("a change to type or media fetches only what the old value kept from being fetched", async () => {
    const { document, loader } = open();
    const kept = preloadLink(document, { as: "image", type: "text/plain", href: "/kept.png" });
    const fetched = preloadLink(document, { as: "image", media: "screen", href: "/fetched.png" });
    document.head.append(kept, fetched);
    await wait(20);
    kept.setAttribute("type", "image/png");
    fetched.setAttribute("media", "all");
    fetched.removeAttribute("media");
    await wait(20);
    assert.equal(loader.count("http://example.test/kept.png"), 1);
    assert.equal(loader.count("http://example.test/fetched.png"), 1);
  });

  specify("a preload in a shadow tree is fetched once the tree is connected", async () => {
    const { document, loader } = open();
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const link = preloadLink(document, { as: "image", href: "/shadow.png" });
    shadow.append(link);
    await wait(20);
    assert.equal(loader.count("http://example.test/shadow.png"), 0);
    const event = eventOf(link);
    document.body.append(host);
    assert.equal(await event, "load");
    assert.equal(loader.count("http://example.test/shadow.png"), 1);
  });

  specify("does not delay the load event", async () => {
    const { loaded } = open(`<link rel="preload" as="script" href="/pending.js">`);
    await loaded;
  });

  specify("a parsed preload is fetched", async () => {
    const { loader, loaded } = open(`<link rel="preload" as="image" href="/parsed.png">`);
    await loaded;
    assert.equal(loader.count("http://example.test/parsed.png"), 1);
  });

  specify("a stylesheet consumes a preloaded style rather than fetching it again", async () => {
    const { window, document, loader } = open();
    const preload = preloadLink(document, { as: "style", href: "/a.css" });
    const preloaded = eventOf(preload);
    document.head.append(preload);
    assert.equal(await preloaded, "load");

    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = "/a.css";
    const applied = eventOf(sheet);
    document.head.append(sheet);
    assert.equal(await applied, "load");
    assert.equal(loader.count("http://example.test/a.css"), 1);
    assert.equal(window.getComputedStyle(document.getElementById("t")).color, "rgb(255, 0, 0)");
  });

  specify("a preload is consumed once: the second use fetches", async () => {
    const { document, loader } = open();
    document.head.append(preloadLink(document, { as: "style", href: "/a.css" }));
    for (let i = 0; i < 2; i++) {
      const sheet = document.createElement("link");
      sheet.rel = "stylesheet";
      sheet.href = "/a.css";
      const event = eventOf(sheet);
      document.head.append(sheet);
      assert.equal(await event, "load");
    }
    assert.equal(loader.count("http://example.test/a.css"), 2);
  });

  specify("the async stylesheet pattern ends up styled, from one fetch", async () => {
    const { window, document, loader, loaded } = open(
      `<link rel="preload" as="style" href="/async.css" onload="this.onload=null;this.rel='stylesheet'">`,
      { runScripts: "dangerously" }
    );
    await loaded;
    const link = document.querySelector("link");
    for (let i = 0; i < 20 && !link.sheet; i++) {
      await wait(10);
    }
    assert.equal(link.rel, "stylesheet");
    assert.ok(link.sheet, "the link has a style sheet");
    assert.equal(window.getComputedStyle(document.getElementById("t")).color, "rgb(255, 0, 0)");
    assert.equal(loader.count("http://example.test/async.css"), 1);
  });

  specify("a stylesheet link whose rel stops naming stylesheet loses its sheet", async () => {
    const { window, document } = open();
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = "/a.css";
    const event = eventOf(sheet);
    document.head.append(sheet);
    assert.equal(await event, "load");
    sheet.rel = "preload";
    assert.equal(sheet.sheet, null);
    assert.notEqual(window.getComputedStyle(document.getElementById("t")).color, "rgb(255, 0, 0)");
  });

  specify("a script consumes a preloaded script", async () => {
    const { document, loader } = open("", { runScripts: "dangerously" });
    const preload = preloadLink(document, { as: "script", href: "/a.js" });
    document.head.append(preload);
    const script = document.createElement("script");
    script.src = "/a.js";
    const event = eventOf(script);
    document.body.append(script);
    assert.equal(await event, "load");
    assert.equal(loader.count("http://example.test/a.js"), 1);
  });

  specify("a stylesheet consumes a preloaded style only when the cors settings match", async () => {
    const { document, loader } = open();
    document.head.append(preloadLink(document, { as: "style", href: "/a.css" }));
    document.head.append(preloadLink(document, { as: "style", href: "/b.css", crossorigin: "anonymous" }));
    for (const href of ["/a.css", "/b.css"]) {
      const sheet = document.createElement("link");
      sheet.rel = "stylesheet";
      sheet.href = href;
      const event = eventOf(sheet);
      document.head.append(sheet);
      assert.equal(await event, "load");
    }
    assert.equal(loader.count("http://example.test/a.css"), 1);
    assert.equal(loader.count("http://example.test/b.css"), 2);
  });

  specify("fetch() consumes a preload made with as=fetch crossorigin", async () => {
    const { window, document, loader } = open();
    document.head.append(preloadLink(document, { as: "fetch", crossorigin: "", href: "/a.xml" }));
    const response = await window.fetch("/a.xml");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/xml");
    assert.equal(await response.text(), BODIES.xml.body);
    assert.equal(loader.count("http://example.test/a.xml"), 1);
  });

  specify("XMLHttpRequest consumes a preload made with as=fetch crossorigin", async () => {
    const { window, document, loader } = open();
    const link = preloadLink(document, { as: "fetch", crossorigin: "", href: "/b.xml" });
    const preloaded = eventOf(link);
    document.head.append(link);
    assert.equal(await preloaded, "load");
    const xhr = new window.XMLHttpRequest();
    await new Promise(resolve => {
      xhr.onloadend = resolve;
      xhr.open("GET", "/b.xml");
      xhr.send();
    });
    assert.equal(xhr.status, 200);
    assert.equal(xhr.responseText, BODIES.xml.body);
    assert.equal(loader.count("http://example.test/b.xml"), 1);
  });

  specify("FontFace consumes a preloaded font", async () => {
    const { window, document, loader } = open();
    const link = preloadLink(document, { as: "font", crossorigin: "", href: "/a.ttf" });
    const preloaded = eventOf(link);
    document.head.append(link);
    assert.equal(await preloaded, "load");
    const face = new window.FontFace("Preloaded", "url(/a.ttf)");
    await face.load();
    assert.equal(face.status, "loaded");
    assert.equal(loader.count("http://example.test/a.ttf"), 1);
  });

  specify("prefetch, preconnect and dns-prefetch fetch nothing and fire nothing", async () => {
    const { document, loader } = open();
    const links = ["prefetch", "preconnect", "dns-prefetch"].map(rel => {
      const link = document.createElement("link");
      link.rel = rel;
      link.href = "/a.css";
      return link;
    });
    const events = links.map(link => eventOf(link, 100));
    document.head.append(...links);
    assert.deepEqual(await Promise.all(events), ["none", "none", "none"]);
    assert.equal(loader.asked.length, 0);
  });
});

describe("Helpers: link rel=modulepreload", () => {
  const preloaded = [];
  let outcome = () => Promise.resolve();

  before(() => setModulePreloader(({ url, type }) => {
    preloaded.push({ url, type });
    return outcome(url);
  }));
  after(() => setModulePreloader(null));

  function moduleLink(document, attributes) {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    for (const [name, value] of Object.entries(attributes)) {
      link.setAttribute(name, value);
    }
    return link;
  }

  specify("hands the module to the preloader, with the type its as names, and fires load", async () => {
    preloaded.length = 0;
    outcome = () => Promise.resolve();
    const { document } = open();
    const links = [
      moduleLink(document, { href: "/m.js" }),
      moduleLink(document, { href: "/s.js", as: "sCrIpT" }),
      moduleLink(document, { href: "/w.js", as: "worker" }),
      moduleLink(document, { href: "/i.js", as: "invalid-dest" }),
      moduleLink(document, { href: "/j.json", as: "json" }),
      moduleLink(document, { href: "/c.css", as: "style" }),
      moduleLink(document, { href: "/t.txt", as: "text" })
    ];
    const events = links.map(link => eventOf(link));
    document.head.append(...links);
    assert.deepEqual(await Promise.all(events), ["load", "load", "load", "load", "load", "load", "load"]);
    assert.deepEqual(preloaded, [
      { url: "http://example.test/m.js", type: "javascript" },
      { url: "http://example.test/s.js", type: "javascript" },
      { url: "http://example.test/w.js", type: "javascript" },
      { url: "http://example.test/i.js", type: "javascript" },
      { url: "http://example.test/j.json", type: "json" },
      { url: "http://example.test/c.css", type: "css" },
      { url: "http://example.test/t.txt", type: "text" }
    ]);
  });

  specify("fires error, without fetching, for a destination that is not a module's", async () => {
    preloaded.length = 0;
    const { document } = open();
    const links = ["image", "font", "audio", "document", "fetch", "iframe"].map(as => moduleLink(document, { href: "/m.js", as }));
    const events = links.map(link => eventOf(link));
    document.head.append(...links);
    assert.deepEqual(await Promise.all(events), ["error", "error", "error", "error", "error", "error"]);
    assert.equal(preloaded.length, 0);
  });

  specify("fetches nothing and fires nothing where media does not match", async () => {
    preloaded.length = 0;
    outcome = () => Promise.resolve();
    const { document } = open();
    const link = moduleLink(document, { href: "/m.js", media: "not all" });
    const event = eventOf(link);
    document.head.append(link);
    assert.equal(await event, "none");
    assert.equal(preloaded.length, 0);
  });

  specify("fires error when the module could not be fetched", async () => {
    outcome = () => Promise.reject(Object.assign(new Error("404"), { fetchFailed: true }));
    const { document } = open();
    const link = moduleLink(document, { href: "/missing.js" });
    const event = eventOf(link);
    document.head.append(link);
    assert.equal(await event, "error");
  });
});

describe("Helpers: a module script's request", () => {
  specify("states the document's origin to another origin", async () => {
    const { window, loader } = open();
    await fetchModuleText(window, "http://other.test/m.js");
    await fetchModuleText(window, "http://example.test/m.js");
    assert.equal(loader.asked[0].options.additionalHeaders.Origin, "http://example.test");
    assert.equal(loader.asked[1].options.additionalHeaders, undefined);
  });
});
