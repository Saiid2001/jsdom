"use strict";
const assert = require("node:assert/strict");
const { describe, specify, before, after } = require("mocha-sugar-free");

const utils = require("../../lib/jsdom/utils");
const { JSDOM, ResourceLoader, VirtualConsole, setImageDecoder } = require("../../lib/api.js");
const { implForWrapper } = require("../../lib/jsdom/living/generated/utils");

// Images are fetched and decoded only where the host supplies a canvas and a
// decoder, which binb does; here a stand-in for each. Every response is a
// 1x1 image, answered when the test says so.

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

class ManualLoader extends ResourceLoader {
  constructor() {
    super();
    this.requests = [];
  }

  fetch(url) {
    let answer;
    const request = new Promise(resolve => {
      answer = () => resolve(Buffer.from([1]));
    });

    request.response = { statusCode: 200, headers: { "content-type": "image/png" } };
    request.href = url;
    request.abort = () => {};
    request.getHeader = () => null;

    this.requests.push({ url, answer });

    return request;
  }

  answerAll() {
    for (const { answer } of this.requests) {
      answer();
    }
  }
}

function page(body) {
  const resources = new ManualLoader();
  const dom = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: "http://example.test/",
    resources,
    runScripts: "dangerously",
    virtualConsole: new VirtualConsole()
  });

  return { window: dom.window, document: dom.window.document, resources };
}

describe("Helpers: image loading", () => {
  let canvas;

  before(() => {
    canvas = utils.Canvas;
    utils.Canvas = {};
    setImageDecoder(async () => ({ kind: "pixels", data: new Uint8ClampedArray(4), width: 1, height: 1 }));
  });

  after(() => {
    utils.Canvas = canvas;
  });

  specify("DOMContentLoaded does not wait for an image, and the load event does", async () => {
    const { window, document, resources } = page(`<img src="/a.png">`);
    const order = [];

    document.addEventListener("DOMContentLoaded", () => order.push("DOMContentLoaded"));
    window.addEventListener("load", () => order.push("window load"));
    document.querySelector("img").addEventListener("load", () => order.push("img load"));

    while (!order.includes("DOMContentLoaded")) {
      await tick();
    }

    assert.deepEqual(order, ["DOMContentLoaded"]);

    resources.answerAll();

    await new Promise(resolve => window.addEventListener("load", resolve));

    assert.deepEqual(order, ["DOMContentLoaded", "img load", "window load"]);
  });

  specify("removing src clears the image and fires nothing", async () => {
    const { document, resources } = page(`<img src="/a.png">`);
    const img = document.querySelector("img");
    const events = [];

    await tick();
    resources.answerAll();
    await new Promise(resolve => img.addEventListener("load", resolve));

    assert.equal(img.width, 1);

    img.addEventListener("load", () => events.push("load"));
    img.addEventListener("error", () => events.push("error"));
    img.removeAttribute("src");
    await tick();

    assert.equal(img.width, 0);
    assert.equal(img.naturalHeight, 0);
    assert.equal(img.complete, true);
    assert.equal(img.currentSrc, "");
    assert.deepEqual(events, []);
  });

  specify("a request a later src replaced fires nothing and does not hold up the load event", async () => {
    const { window, document, resources } = page(`<img src="/slow.png">`);
    const img = document.querySelector("img");
    const events = [];

    img.addEventListener("load", () => events.push("load"));
    img.addEventListener("error", () => events.push("error"));

    await tick();
    assert.equal(img.complete, false);

    img.src = "";

    await new Promise(resolve => window.addEventListener("load", resolve));
    assert.equal(img.complete, true);

    resources.answerAll();
    await tick();
    await tick();

    // Only the error src = "" fires itself: the replaced request fires nothing.
    assert.deepEqual(events, ["error"]);
    assert.equal(img.naturalWidth, 0);
  });

  specify("loading=lazy defers the fetch until it is resumed", async () => {
    const { document, resources } = page(`<img loading="lazy" src="/lazy.png">`);
    const img = document.querySelector("img");
    const impl = implForWrapper(img);

    await tick();

    assert.equal(img.loading, "lazy");
    assert.equal(resources.requests.length, 0);
    assert.ok(implForWrapper(document)._lazyLoadImages.has(impl));

    impl._resumeLazyLoad();

    assert.deepEqual(resources.requests.map(r => r.url), ["http://example.test/lazy.png"]);
    assert.equal(implForWrapper(document)._lazyLoadImages.has(impl), false);
  });

  specify("src then loading=lazy in one task defers the fetch", async () => {
    const { document, resources } = page(``);
    const img = document.createElement("img");

    img.src = "/b.png";
    img.loading = "lazy";
    document.body.appendChild(img);
    await tick();

    assert.equal(resources.requests.length, 0);
  });

  specify("loading changed to eager resumes the deferred fetch", async () => {
    const { document, resources } = page(`<img loading="lazy" src="/c.png">`);
    const img = document.querySelector("img");

    await tick();
    assert.equal(resources.requests.length, 0);

    img.loading = "eager";

    assert.equal(resources.requests.length, 1);
  });

  specify("a mutation that is not src leaves a deferred fetch deferred", async () => {
    const { document, resources } = page(`<img loading="lazy" src="/d.png">`);
    const img = document.querySelector("img");

    await tick();
    img.crossOrigin = "anonymous";
    img.setAttribute("referrerpolicy", "no-referrer");
    img.src = "/e.png";
    await tick();

    assert.equal(resources.requests.length, 0);
  });

  specify("an invalid loading value is eager", async () => {
    const { document, resources } = page(`<img loading="sometime" src="/f.png">`);

    await tick();

    assert.equal(document.querySelector("img").loading, "eager");
    assert.equal(resources.requests.length, 1);
  });

  // https://html.spec.whatwg.org/multipage/images.html#updating-the-image-data: with no source to select, an element
  // that has a src attribute fires error; with a source that does not parse as a URL, it fires error too. Either is
  // queued as a task, after the script that set src, and leaves the element complete.
  specify("an empty src fires error in a later task, and no src fires nothing", async () => {
    const { document } = page(`<img id="empty" src=""><img id="none">`);
    const events = [];

    for (const img of document.querySelectorAll("img")) {
      img.addEventListener("load", () => events.push(`load ${img.id}`));
      img.addEventListener("error", () => events.push(`error ${img.id}`));
    }

    const set = document.createElement("img");
    set.src = "";
    set.addEventListener("error", () => events.push("error set"));
    assert.deepEqual(events, []);

    await new Promise(resolve => {
      setTimeout(resolve, 10);
    });

    assert.deepEqual(events.sort(), ["error empty", "error set"]);
    assert.equal(set.complete, true);
  });

  specify("a src that is not a valid URL fires error and is complete, with nothing fetched", async () => {
    const { document, resources } = page(``);
    const img = document.createElement("img");
    img.src = "http://[";
    assert.equal(img.complete, false);

    const event = await new Promise(resolve => {
      img.onload = img.onerror = resolve;
    });

    assert.equal(event.type, "error");
    assert.equal(img.complete, true);
    assert.equal(resources.requests.length, 0);
  });
});
