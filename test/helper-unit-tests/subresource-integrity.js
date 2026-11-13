"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");
const { parseMetadata, bytesMatchMetadata } = require("../../lib/jsdom/living/helpers/integrity.js");

// Subresource Integrity (https://w3c.github.io/webappsec-subresource-integrity/):
// a script, a style sheet or a fetch() whose integrity metadata does not match
// the bytes it received is a network error, and so is one whose response the
// page may not read (an opaque, cross-origin no-cors response).

// Bare names are the host's to bind, so a script reports that it ran by
// throwing, which the virtual console hears.
const BODY = "throw new Error(\"ran\");";
const CSS = "#x { color: rgb(0, 128, 0) }";

function hash(alg, body) {
  return `${alg}-${crypto.createHash(alg).update(body).digest("base64")}`;
}
const WRONG = "sha256-dKUcPOn/AlUjWIwcHeHNqYXPlvyGiq+2dWOdFcE+24I=";

describe("Helpers: integrity metadata", () => {
  specify("parses the supported algorithms and ignores the rest", () => {
    assert.deepEqual(parseMetadata("sha256-a sha1-b md5-c SHA384-d?opt sha512-e"), [
      { alg: "sha256", val: "a" },
      { alg: "sha384", val: "d" },
      { alg: "sha512", val: "e" }
    ]);
    assert.deepEqual(parseMetadata("?-= -hash sha256"), []);
  });

  specify("a value that is not base64 or base64url, or is empty, is no metadata at all", () => {
    assert.deepEqual(parseMetadata("sha256-... sha256- sha384-a=b"), []);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), "sha256-..."), true);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), "sha256-"), true);
  });

  specify("the strongest algorithm decides, and any match of it is enough", () => {
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), hash("sha256", BODY)), true);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), `${WRONG} ${hash("sha384", BODY)}`), true);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), `${hash("sha256", BODY)} sha512-AAAA`), false);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), `sha512-AAAA ${hash("sha512", BODY)}`), true);
  });

  specify("base64url and missing padding name the same digest", () => {
    const value = hash("sha512", BODY);
    const url = value.replace(/\+/g, "-").replace(/\//g, "_");

    assert.equal(bytesMatchMetadata(Buffer.from(BODY), value.replace(/=+$/, "")), true);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), url), true);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), url.replace(/=+$/, "")), true);
  });

  specify("metadata naming no supported algorithm matches anything", () => {
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), ""), true);
    assert.equal(bytesMatchMetadata(Buffer.from(BODY), "sha1-xyz"), true);
  });
});

// Answers every URL with the body its path names, and the headers its query
// asks for.
class SiteLoader extends ResourceLoader {
  fetch(url) {
    const parsed = new URL(url);
    const body = parsed.pathname.endsWith(".css") ? CSS : BODY;
    const defaultType = parsed.pathname.endsWith(".css") ? "text/css" : "text/javascript";
    const headers = { "content-type": parsed.searchParams.get("type") ?? defaultType };

    if (parsed.searchParams.has("acao")) {
      headers["access-control-allow-origin"] = parsed.searchParams.get("acao");
    }
    if (parsed.searchParams.has("acac")) {
      headers["access-control-allow-credentials"] = "true";
    }
    if (parsed.searchParams.has("nosniff")) {
      headers["x-content-type-options"] = parsed.searchParams.get("nosniff") || "nosniff";
    }

    const request = Promise.resolve(Buffer.from(body));
    request.response = { statusCode: 200, headers };
    request.statusCode = 200;
    request.href = url;
    request.abort = () => {};
    request.getHeader = () => null;
    return request;
  }
}

function page() {
  const virtualConsole = new VirtualConsole();
  const { window } = new JSDOM("<!DOCTYPE html><body><div id=x></div></body>", {
    url: "https://site.test/",
    runScripts: "dangerously",
    resources: new SiteLoader(),
    virtualConsole
  });
  virtualConsole.on("jsdomError", error => {
    if (/ran/.test(String(error.message))) {
      window.ran = (window.ran || 0) + 1;
    }
  });
  return window;
}

function loadScript(src, attributes, after) {
  return new Promise(resolve => {
    const window = page();
    const script = window.document.createElement("script");

    for (const [name, value] of Object.entries(attributes || {})) {
      script.setAttribute(name, value);
    }
    script.onload = () => resolve({ event: "load", ran: window.ran });
    script.onerror = () => resolve({ event: "error", ran: window.ran });
    script.src = src;
    window.document.body.appendChild(script);
    if (after) {
      after(script);
    }
  });
}

function loadStyle(href, attributes = {}) {
  return new Promise(resolve => {
    const window = page();
    const link = window.document.createElement("link");

    for (const [name, value] of Object.entries(attributes)) {
      link.setAttribute(name, value);
    }
    function color() {
      return window.getComputedStyle(window.document.getElementById("x")).color;
    }
    link.onload = () => resolve({ event: "load", color: color() });
    link.onerror = () => resolve({ event: "error", color: color() });
    link.rel = "stylesheet";
    link.href = href;
    window.document.head.appendChild(link);
  });
}

describe("Helpers: integrity of a classic script", () => {
  specify("a matching hash runs the script", async () => {
    assert.deepEqual(await loadScript("/s.js", { integrity: hash("sha384", BODY) }), { event: "load", ran: 1 });
  });

  specify("a mismatching hash fires error and does not run it", async () => {
    assert.deepEqual(await loadScript("/s.js", { integrity: WRONG }), { event: "error", ran: undefined });
  });

  specify("the metadata is the attribute's value when the script was prepared", async () => {
    const result = await loadScript("/s.js", { integrity: WRONG }, script => script.removeAttribute("integrity"));
    assert.equal(result.event, "error");
  });

  specify("a cross-origin script without CORS cannot be checked, and fails", async () => {
    const result = await loadScript("https://other.test/s.js", { integrity: hash("sha256", BODY) });
    assert.equal(result.event, "error");
  });

  specify("a cross-origin script fetched with CORS and shared is checked", async () => {
    const ok = await loadScript("https://other.test/s.js?acao=*", {
      integrity: hash("sha256", BODY), crossorigin: "anonymous"
    });
    assert.equal(ok.event, "load");

    const bad = await loadScript("https://other.test/s.js?acao=*", { integrity: WRONG, crossorigin: "anonymous" });
    assert.equal(bad.event, "error");
  });

  specify("a cross-origin script whose CORS check fails is not checked, and fails", async () => {
    const result = await loadScript("https://other.test/s.js", {
      integrity: hash("sha256", BODY), crossorigin: "anonymous"
    });
    assert.equal(result.event, "error");

    const credentialed = await loadScript("https://other.test/s.js?acao=*", {
      integrity: hash("sha256", BODY), crossorigin: "use-credentials"
    });
    assert.equal(credentialed.event, "error");

    const allowed = await loadScript("https://other.test/s.js?acao=https://site.test&acac", {
      integrity: hash("sha256", BODY), crossorigin: "use-credentials"
    });
    assert.equal(allowed.event, "load");
  });
});

describe("Helpers: integrity of a style sheet", () => {
  specify("a matching hash applies the sheet", async () => {
    assert.deepEqual(
      await loadStyle("/s.css", { integrity: hash("sha256", CSS) }),
      { event: "load", color: "rgb(0, 128, 0)" }
    );
  });

  specify("a mismatching hash fires error and does not apply it", async () => {
    const result = await loadStyle("/s.css", { integrity: WRONG });
    assert.equal(result.event, "error");
    assert.notEqual(result.color, "rgb(0, 128, 0)");
  });

  specify("a cross-origin sheet without CORS fails", async () => {
    assert.equal((await loadStyle("https://other.test/s.css", { integrity: hash("sha256", CSS) })).event, "error");
  });
});

describe("Helpers: X-Content-Type-Options: nosniff", () => {
  specify("a script with nosniff and no JavaScript type is not run", async () => {
    assert.deepEqual(await loadScript("/s.js?type=text/plain&nosniff"), { event: "error", ran: undefined });
    assert.equal((await loadScript("/s.js?type=&nosniff")).event, "error");
  });

  specify("a script with nosniff and a JavaScript type runs", async () => {
    assert.equal((await loadScript("/s.js?type=application/javascript&nosniff=NOSNIFF")).event, "load");
  });

  specify("only a first value of exactly nosniff counts", async () => {
    assert.equal((await loadScript("/s.js?type=text/plain&nosniff=nosniff%0C")).event, "load");
    assert.equal((await loadScript("/s.js?type=text/plain&nosniff=nosniff,,@")).event, "error");
    assert.equal((await loadScript("/s.js?type=text/plain&nosniff=no,nosniff")).event, "load");
  });

  specify("a style sheet with nosniff and no text/css type is not applied", async () => {
    const result = await loadStyle("/s.css?type=text/plain&nosniff");
    assert.equal(result.event, "error");
    assert.notEqual(result.color, "rgb(0, 128, 0)");
  });

  specify("a style sheet with nosniff and text/css is applied", async () => {
    assert.equal((await loadStyle("/s.css?type=text/css&nosniff")).event, "load");
  });
});

describe("Helpers: a script's encoding from its Content-Type", () => {
  specify("the charset of the last parsable type of several is used", () => {
    const { extractMIMEType } = require("../../lib/jsdom/living/helpers/content-type.js");

    assert.equal(extractMIMEType({ "content-type": "text/javascript;charset=windows-1252, x/x" }).toString(), "x/x");
    assert.equal(extractMIMEType({ "content-type": "text/javascript;charset=windows-1252, text/javascript" })
      .toString(), "text/javascript;charset=windows-1252");
    assert.equal(extractMIMEType({ "content-type": "text/javascript;\" x/x" }).toString(), "text/javascript");
    assert.equal(extractMIMEType({ "content-type": "*/*, text/html" }).essence, "text/html");
    assert.equal(extractMIMEType({}), null);
  });
});

// A server answering as the site the BSBX-PROXY-HOST header names.
async function site(respond) {
  const server = await createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const headers = { "BSBX-PROXY-HOST": req.headers["bsbx-proxy-host"], ...respond(url, req) };
    res.writeHead(200, headers);
    res.end(BODY);
  });

  class Loader extends ResourceLoader {
    constructor() {
      super();
      this.proxyUrl = `http://127.0.0.1:${server.address().port}/proxy`;
    }
  }

  const { window } = new JSDOM("", {
    url: "https://site.test/page",
    resources: new Loader(),
    virtualConsole: new VirtualConsole()
  });

  function done() {
    window.close();
    server.destroy();
  }

  return { window, done };
}

describe("Helpers: integrity of fetch()", () => {
  specify("a matching hash resolves, a mismatching one rejects", async () => {
    const { window, done } = await site(() => ({ "Content-Type": "text/plain" }));
    try {
      const response = await window.fetch("https://site.test/top.txt", { integrity: hash("sha512", BODY) });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), BODY);

      await assert.rejects(window.fetch("https://site.test/top.txt", { integrity: WRONG }), error => error instanceof window.TypeError);
      await assert.rejects(window.fetch("https://site.test/top.txt", {
        integrity: `sha512-AAAA ${hash("sha384", BODY)}`
      }), error => error instanceof window.TypeError);
    } finally {
      done();
    }
  });

  specify("an opaque response fails any integrity check", async () => {
    const { window, done } = await site(() => ({ "Content-Type": "text/plain" }));
    try {
      const empty = await window.fetch("https://other.test/top.txt", { mode: "no-cors", integrity: "" });
      assert.equal(empty.type, "opaque");

      await assert.rejects(window.fetch("https://other.test/top.txt", {
        mode: "no-cors", integrity: hash("sha512", BODY)
      }), error => error instanceof window.TypeError);
    } finally {
      done();
    }
  });

  specify("a CORS response is checked", async () => {
    const { window, done } = await site(() => ({ "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }));
    try {
      const response = await window.fetch("https://other.test/top.txt", { integrity: hash("sha512", BODY) });
      assert.equal(response.status, 200);
      await assert.rejects(window.fetch("https://other.test/top.txt", { integrity: WRONG }));
    } finally {
      done();
    }
  });
});

describe("Helpers: a body's blob type", () => {
  specify("is the MIME type extracted from Content-Type, serialized", async () => {
    const { window } = new JSDOM("", { url: "https://site.test/" });
    const request = new window.Request("https://site.test/", {
      method: "POST", body: "x", headers: [["Content-Type", "TEXT/HTML;CHARSET=GBK"]]
    });
    const blob = await request.blob();

    assert.equal(blob instanceof window.Blob, true);
    assert.equal(blob.type, "text/html;charset=GBK");
    assert.equal(blob.size, 1);

    const response = new window.Response(null, { headers: [["Content-Type", "text/html;charset=gbk("]] });
    assert.equal((await response.blob()).type, "text/html;charset=\"gbk(\"");

    const untyped = new window.Response("abc");
    assert.equal((await untyped.blob()).type, "text/plain;charset=UTF-8");
  });
});

describe("Helpers: integrity of a module script's entry", () => {
  const { setModuleEvaluator } = require("../../lib/api.js");

  // Fetches the entry through the fork, as a host's module loader does.
  function evaluator({ source, url, fetchText }) {
    const fetched = source === undefined ? fetchText(url, { type: "javascript" }) : Promise.resolve(source);
    return fetched.then(() => () => undefined, error => {
      throw Object.assign(new Error(`Could not read module ${url}`), { fetchFailed: true, cause: error });
    });
  }

  function loadModule(src, attributes) {
    return new Promise(resolve => {
      const window = page();
      const script = window.document.createElement("script");
      script.type = "module";
      for (const [name, value] of Object.entries(attributes)) {
        script.setAttribute(name, value);
      }
      script.onload = () => resolve("load");
      script.onerror = () => resolve("error");
      script.src = src;
      window.document.body.appendChild(script);
    });
  }

  specify("a matching hash loads, a mismatching one fires error", async () => {
    setModuleEvaluator(evaluator);
    try {
      assert.equal(await loadModule("/m.js", { integrity: hash("sha256", BODY) }), "load");
      assert.equal(await loadModule("/m2.js", { integrity: WRONG }), "error");
      assert.equal(await loadModule("https://other.test/m.js", { integrity: hash("sha256", BODY) }), "error");
      assert.equal(await loadModule("https://other.test/m.js?acao=*", { integrity: hash("sha256", BODY) }), "load");
    } finally {
      setModuleEvaluator(null);
    }
  });

  specify("a module with nosniff and no JavaScript type fires error", async () => {
    setModuleEvaluator(evaluator);
    try {
      assert.equal(await loadModule("/m3.js?type=&nosniff", {}), "error");
    } finally {
      setModuleEvaluator(null);
    }
  });
});

describe("Helpers: integrity of a preload", () => {
  function preload(href, attributes) {
    return new Promise(resolve => {
      const window = page();
      const link = window.document.createElement("link");
      for (const [name, value] of Object.entries(attributes)) {
        link.setAttribute(name, value);
      }
      link.onload = () => resolve("load");
      link.onerror = () => resolve("error");
      link.href = href;
      window.document.head.appendChild(link);
    });
  }

  specify("preload and modulepreload are supported link types", () => {
    const link = page().document.createElement("link");
    assert.equal(link.relList.supports("preload"), true);
    assert.equal(link.relList.supports("modulepreload"), true);
  });

  specify("a preload is checked against its integrity metadata", async () => {
    assert.equal(await preload("/s.js", { rel: "preload", as: "script", integrity: hash("sha256", BODY) }), "load");
    assert.equal(await preload("/s.js", { rel: "preload", as: "script", integrity: WRONG }), "error");
    assert.equal(await preload("/s.css", { rel: "preload", as: "style", integrity: WRONG }), "error");
    assert.equal(await preload("https://other.test/s.js", {
      rel: "preload", as: "script", integrity: hash("sha256", BODY)
    }), "error");
  });

  specify("a modulepreload is a CORS request checked against its integrity metadata", async () => {
    assert.equal(await preload("/m.js", { rel: "modulepreload", integrity: hash("sha384", BODY) }), "load");
    assert.equal(await preload("/m.js", { rel: "modulepreload", integrity: WRONG }), "error");
    assert.equal(await preload("https://other.test/m.js?acao=*", {
      rel: "modulepreload", integrity: hash("sha256", BODY)
    }), "load");
    assert.equal(await preload("https://other.test/m.js", {
      rel: "modulepreload", integrity: hash("sha256", BODY)
    }), "error");
  });
});
