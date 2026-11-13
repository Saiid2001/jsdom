"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole, determineReferrer, parseReferrerPolicy } =
  require("../../lib/api.js");
const { createServer } = require("../util.js");

// Referrer Policy: one computation of a request's referrer, which every
// request a document starts goes through, and the policy each is under.

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A loader that answers from `files` and records what each request asked for.
class RecordingLoader extends ResourceLoader {
  constructor(files = {}) {
    super();
    this.files = files;
    this.calls = [];
  }

  fetch(url, options) {
    this.calls.push({ url, referrer: options.referrer, referrerPolicy: options.referrerPolicy });
    const file = this.files[url] || { body: "" };
    const promise = Promise.resolve(Buffer.from(file.body));
    promise.abort = () => {};
    promise.href = url;
    promise.response = { statusCode: 200, headers: { "content-type": file.type || "text/plain", ...file.headers } };
    promise.getHeader = name => promise.response.headers[name.toLowerCase()] ?? null;
    return promise;
  }

  callFor(url) {
    return this.calls.find(call => call.url === url);
  }
}

function page(html, options = {}) {
  const resources = new RecordingLoader(options.files);
  const dom = new JSDOM(html, {
    url: options.url || "https://site.test/page?q=1#frag",
    runScripts: "dangerously",
    resources,
    virtualConsole: new VirtualConsole(),
    ...options.referrerPolicy ? { referrerPolicy: options.referrerPolicy } : {}
  });
  return { window: dom.window, resources };
}

function navigationOf(window, act) {
  return new Promise(resolve => {
    window.document.addEventListener("navigate", event => resolve(event.detail));
    act();
  });
}

describe("Helpers: referrer policy, the computation", () => {
  specify("reduces the referrer by each policy", () => {
    const source = "https://user:pw@site.test/a/b?c=1#d";
    const same = "https://site.test/x";
    const cross = "https://other.test/x";
    const insecure = "http://other.test/x";

    assert.equal(determineReferrer(source, same, ""), "https://site.test/a/b?c=1");
    assert.equal(determineReferrer(source, cross, ""), "https://site.test/");
    assert.equal(determineReferrer(source, insecure, ""), null);
    assert.equal(determineReferrer(source, cross, "no-referrer"), null);
    assert.equal(determineReferrer(source, insecure, "no-referrer-when-downgrade"), null);
    assert.equal(determineReferrer(source, cross, "no-referrer-when-downgrade"), "https://site.test/a/b?c=1");
    assert.equal(determineReferrer(source, cross, "same-origin"), null);
    assert.equal(determineReferrer(source, same, "same-origin"), "https://site.test/a/b?c=1");
    assert.equal(determineReferrer(source, insecure, "origin"), "https://site.test/");
    assert.equal(determineReferrer(source, insecure, "strict-origin"), null);
    assert.equal(determineReferrer(source, cross, "origin-when-cross-origin"), "https://site.test/");
    assert.equal(determineReferrer(source, insecure, "unsafe-url"), "https://site.test/a/b?c=1");
  });

  specify("sends nothing from a local scheme", () => {
    assert.equal(determineReferrer("about:blank", "https://site.test/", "unsafe-url"), null);
    assert.equal(determineReferrer("data:text/html,x", "https://site.test/", "unsafe-url"), null);
  });

  specify("treats a localhost address as trustworthy, so going there from https is no downgrade", () => {
    assert.equal(
      determineReferrer("https://site.test/a", "http://wpt.localhost:8000/b", "strict-origin"),
      "https://site.test/"
    );
  });

  specify("reduces a referrer longer than 4096 bytes to its origin", () => {
    const prefix = "http://site.test/";
    const exact = prefix + "a".repeat(4096 - prefix.length);
    const over = exact + "a";

    assert.equal(determineReferrer(exact, "http://site.test/x", "unsafe-url"), exact);
    assert.equal(determineReferrer(over, "http://site.test/x", "unsafe-url"), prefix);
  });

  specify("reads the last valid token of a Referrer-Policy header, over several headers", () => {
    assert.equal(parseReferrerPolicy("origin, bogus"), "origin");
    assert.equal(parseReferrerPolicy("no-referrer, unsafe-url"), "unsafe-url");
    assert.equal(parseReferrerPolicy(["origin", "same-origin, nonsense"]), "same-origin");
    assert.equal(parseReferrerPolicy("never"), "");
  });
});

describe("Helpers: referrer policy, the document's", () => {
  specify("is the one the last processed <meta name=referrer> states, legacy values mapped", () => {
    const { window } = page(`<meta name="referrer" content="never">`);
    const { document } = window;
    const first = document.querySelector("meta");

    const second = document.createElement("meta");
    second.name = "referrer";
    second.content = "origin";
    document.head.insertBefore(second, first);

    return navigationOf(window, () => {
      window.location.href = "https://other.test/next";
    }).then(detail => {
      assert.equal(detail.referrerPolicy, "origin");
      assert.equal(detail.referrer, "https://site.test/");
    });
  });

  specify("keeps the policy a removed meta set, and takes a changed content", async () => {
    const { window } = page(`<meta name="referrer" content="no-referrer"><meta id="b" name="referrer" content="origin">`);
    const { document } = window;

    document.getElementById("b").remove();
    let detail = await navigationOf(window, () => {
      window.location.href = "https://site.test/next";
    });
    assert.equal(detail.referrer, "https://site.test/");

    document.querySelector("meta").content = "unsafe-url";
    detail = await navigationOf(window, () => {
      window.location.href = "https://other.test/next";
    });
    assert.equal(detail.referrer, "https://site.test/page?q=1");
  });

  specify("is not set by a meta in a document the window is not showing", async () => {
    const { window } = page("");
    new window.DOMParser().parseFromString(`<meta name="referrer" content="no-referrer">`, "text/html");
    const detail = await navigationOf(window, () => {
      window.location.href = "https://site.test/next";
    });
    assert.equal(detail.referrer, "https://site.test/page?q=1");
  });

  specify("starts as the policy the document's response stated", async () => {
    const { window } = page("", { referrerPolicy: "no-referrer" });
    const detail = await navigationOf(window, () => {
      window.location.href = "https://site.test/next";
    });
    assert.equal(detail.referrer, null);
  });
});

describe("Helpers: referrer policy, a navigation's", () => {
  specify("follows a link's referrerpolicy, and rel=noreferrer over it", async () => {
    const { window } = page(`<a id="a" href="https://other.test/x" referrerpolicy="unsafe-url">a</a>` +
      `<a id="b" href="https://other.test/x" rel="noreferrer" referrerpolicy="unsafe-url">b</a>`);
    const { document } = window;

    let detail = await navigationOf(window, () => document.getElementById("a").click());
    assert.equal(detail.referrer, "https://site.test/page?q=1");
    assert.equal(detail.referrerPolicy, "unsafe-url");

    detail = await navigationOf(window, () => document.getElementById("b").click());
    assert.equal(detail.referrer, null);
  });

  specify("submits a form under the document's policy", async () => {
    const { window } = page(`<meta name="referrer" content="origin">` +
      `<form action="https://site.test/search"><input name="q" value="x"></form>`);
    const detail = await navigationOf(window, () => window.document.forms[0].submit());
    assert.equal(detail.referrer, "https://site.test/");
  });
});

describe("Helpers: referrer policy, an element's request", () => {
  specify("carries the document's address and its policy, or the element's own", async () => {
    const { window, resources } = page(`<meta name="referrer" content="origin">` +
      `<script src="https://cdn.test/a.js"></script>` +
      `<script src="https://cdn.test/b.js" referrerpolicy="NO-REFERRER"></script>` +
      `<script src="https://cdn.test/c.js" referrerpolicy="bogus"></script>` +
      `<link rel="stylesheet" href="https://cdn.test/s.css" referrerpolicy="unsafe-url">`);
    await delay(50);

    assert.deepEqual(
      resources.callFor("https://cdn.test/a.js"),
      { url: "https://cdn.test/a.js", referrer: "https://site.test/page?q=1#frag", referrerPolicy: "origin" }
    );
    assert.equal(resources.callFor("https://cdn.test/b.js").referrerPolicy, "no-referrer");
    assert.equal(resources.callFor("https://cdn.test/c.js").referrerPolicy, "origin");
    assert.equal(resources.callFor("https://cdn.test/s.css").referrerPolicy, "unsafe-url");
    window.close();
  });

  specify("an @import is made from the sheet holding it, under that sheet's policy", async () => {
    const files = {
      "https://cdn.test/outer.css": {
        body: `@import url("inner.css");`,
        type: "text/css",
        headers: { "referrer-policy": "no-referrer" }
      },
      "https://cdn.test/plain.css": { body: `@import url("inner2.css");`, type: "text/css" }
    };
    const { window, resources } = page(
      `<link rel="stylesheet" href="https://cdn.test/outer.css">` +
      `<link rel="stylesheet" href="https://cdn.test/plain.css">` +
      `<style>@import url("https://cdn.test/inline-import.css");</style>`,
      { files }
    );
    await delay(50);

    assert.deepEqual(
      resources.callFor("https://cdn.test/inner.css"),
      { url: "https://cdn.test/inner.css", referrer: "https://cdn.test/outer.css", referrerPolicy: "no-referrer" }
    );
    assert.deepEqual(
      resources.callFor("https://cdn.test/inner2.css"),
      { url: "https://cdn.test/inner2.css", referrer: "https://cdn.test/plain.css", referrerPolicy: "" }
    );
    assert.equal(
      resources.callFor("https://cdn.test/inline-import.css").referrer,
      "https://site.test/page?q=1#frag"
    );
    window.close();
  });

  specify("a url() in a stylesheet is recorded with the sheet it came from", async () => {
    const files = {
      "https://cdn.test/s.css": {
        body: `.a { background-image: url(img/a.png) }`,
        type: "text/css",
        headers: { "referrer-policy": "origin" }
      }
    };
    const { window } = page(`<link rel="stylesheet" href="https://cdn.test/s.css">`, { files });
    await delay(50);

    const { cssURLRequest } = require("../../lib/api.js");
    assert.deepEqual(
      cssURLRequest(window.document, "img/a.png"),
      { url: "https://cdn.test/img/a.png", referrer: "https://cdn.test/s.css", referrerPolicy: "origin" }
    );
    assert.equal(cssURLRequest(window.document, "img/unknown.png"), null);
    window.close();
  });
});

describe("Helpers: referrer policy, across redirects", () => {
  async function proxyPage(head = "") {
    const seen = [];
    const server = await createServer((req, res) => {
      const url = new URL(req.url.replace(/^\/proxy/, ""), req.headers["bsbx-proxy-host"]);
      seen.push({ url: url.href, referer: req.headers.referer });
      const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" };
      if (url.searchParams.has("to")) {
        headers.Location = url.searchParams.get("to");
        res.writeHead(302, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      res.end("ok");
    });

    class Loader extends ResourceLoader {
      constructor() {
        super();
        this.proxyUrl = `http://127.0.0.1:${server.address().port}/proxy`;
      }
    }

    const { window } = new JSDOM(`<head>${head}</head>`, {
      url: "https://site.test/page?q=1",
      resources: new Loader(),
      virtualConsole: new VirtualConsole()
    });

    return { window, seen, done: () => {
      window.close(); server.destroy();
    } };
  }

  specify("a referrer reduced on one hop stays reduced on the next", async () => {
    const { window, seen, done } = await proxyPage();
    try {
      await window.fetch("https://other.test/r?to=" + encodeURIComponent("https://site.test/back"));
      assert.equal(seen[0].referer, "https://site.test/");
      assert.equal(seen[1].url, "https://site.test/back");
      assert.equal(seen[1].referer, "https://site.test/");
    } finally {
      done();
    }
  });

  specify("a referrer longer than 4096 bytes is sent as its origin", async () => {
    const { window, seen, done } = await proxyPage();
    try {
      window.history.replaceState(null, "", "/" + "a".repeat(4100));
      await window.fetch("https://site.test/a");
      assert.equal(seen[0].referer, "https://site.test/");
    } finally {
      done();
    }
  });
});

describe("Helpers: referrer policy, a document loaded from a URL", () => {
  specify("is under its response's Referrer-Policy, and its referrer is the Referer it was requested with", async () => {
    const seen = [];
    const server = await createServer((req, res) => {
      seen.push(req.headers.referer);
      res.writeHead(200, { "Content-Type": "text/html", "Referrer-Policy": "bogus, same-origin" });
      res.end("<p>hi</p>");
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const dom = await JSDOM.fromURL(`${base}/doc`, {
        referrer: "http://elsewhere.test/from?x=1",
        navigationOptions: { referrerPolicy: "origin" },
        virtualConsole: new VirtualConsole()
      });
      assert.equal(seen[0], "http://elsewhere.test/");
      assert.equal(dom.window.document.referrer, "http://elsewhere.test/");

      const detail = await navigationOf(dom.window, () => {
        dom.window.location.href = "http://other.test/next";
      });
      assert.equal(detail.referrerPolicy, "same-origin");
      assert.equal(detail.referrer, null);
      dom.window.close();
    } finally {
      await server.destroy();
    }
  });
});

describe("Helpers: referrer policy, a frame's document", () => {
  specify("is under its response's Referrer-Policy, and its referrer is the one it was requested with", async () => {
    const files = {
      "https://other.test/frame.html": {
        body: "<p>frame</p>",
        type: "text/html",
        headers: { "referrer-policy": "no-referrer" }
      }
    };
    const { window } = page(`<iframe src="https://other.test/frame.html"></iframe>`, { files });
    await delay(100);

    const frameDocument = window.document.querySelector("iframe").contentDocument;
    const detail = await navigationOf(frameDocument.defaultView, () => {
      frameDocument.defaultView.location.href = "https://other.test/next";
    });
    assert.equal(detail.referrerPolicy, "no-referrer");
    window.close();
  });

  specify("an about:blank frame takes its parent's policy", async () => {
    const { window } = page(`<meta name="referrer" content="origin"><iframe></iframe>`);
    await delay(20);

    const frameWindow = window.document.querySelector("iframe").contentWindow;
    const detail = await navigationOf(frameWindow, () => {
      frameWindow.location.href = "https://other.test/next";
    });
    assert.equal(detail.referrerPolicy, "origin");
    window.close();
  });
});
