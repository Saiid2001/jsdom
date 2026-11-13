"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// CSS Font Loading: document.fonts, FontFace and FontFaceSet. No host font is
// ever reported: local() never matches, and a face's bytes are only checked for
// a font file's signature.
// https://drafts.csswg.org/css-font-loading/
const TTF = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);

function loaded(html = "") {
  const dom = new JSDOM(html, { url: "http://example.test/", pretendToBeVisual: true });
  return new Promise(resolve => {
    dom.window.addEventListener("load", () => resolve(dom.window));
  });
}

describe("Helpers: CSS Font Loading", () => {
  specify("document.fonts is a FontFaceSet, the same object every time", async () => {
    const window = await loaded();
    assert.ok(window.document.fonts instanceof window.FontFaceSet);
    assert.ok(window.document.fonts instanceof window.EventTarget);
    assert.equal(window.document.fonts, window.document.fonts);
  });

  specify("ready resolves with the set once the document has loaded", async () => {
    const window = await loaded();
    const fonts = await window.document.fonts.ready;
    assert.equal(fonts, window.document.fonts);
    assert.equal(fonts.status, "loaded");
  });

  specify("ready read while the document loads resolves after it has", async () => {
    const dom = new JSDOM("", { url: "http://example.test/" });
    const { ready } = dom.window.document.fonts;
    let loadFired = false;
    dom.window.addEventListener("load", () => {
      loadFired = true;
    });
    await ready;
    assert.equal(loadFired, true);
  });

  specify("an @font-face rule is a CSS-connected face in the set", async () => {
    const window = await loaded(
      `<style>@font-face { font-family: "Test Face"; src: url(/x.ttf); font-style: italic }</style>`
    );
    const faces = Array.from(window.document.fonts);
    assert.equal(faces.length, 1);
    assert.equal(window.document.fonts.size, 1);
    assert.equal(faces[0].family, "Test Face");
    assert.equal(faces[0].style, "italic");
    assert.equal(faces[0].status, "unloaded");
    assert.equal(window.document.fonts.delete(faces[0]), false);
    assert.throws(() => window.document.fonts.add(faces[0]), e => e.name === "InvalidModificationError");
  });

  specify("check() is true when nothing matches, false for an unloaded match", async () => {
    const window = await loaded(`<style>@font-face { font-family: Foo; src: url(/x.ttf) }</style>`);
    assert.equal(window.document.fonts.check("12px nothing-here"), true);
    assert.equal(window.document.fonts.check("12px Foo"), false);
    assert.throws(() => window.document.fonts.check("Foo"), e => e.name === "SyntaxError");
  });

  specify("a face from font data loads, and one from bad data fails with SyntaxError", async () => {
    const window = await loaded();
    const good = new window.FontFace("Good", TTF);
    assert.equal(good.status, "loading");
    assert.equal(await good.loaded, good);
    assert.equal(good.status, "loaded");

    const bad = new window.FontFace("Bad", new Uint8Array([1, 2, 3, 4]));
    await assert.rejects(bad.loaded, e => e.name === "SyntaxError");
    assert.equal(bad.status, "error");
  });

  specify("a descriptor that does not parse makes an errored face with empty attributes", async () => {
    const window = await loaded();
    const face = new window.FontFace("X", "url(x.ttf)", { weight: "heavy" });
    assert.equal(face.status, "error");
    assert.equal(face.family, "");
    assert.equal(face.weight, "");
    await assert.rejects(face.loaded, e => e.name === "SyntaxError");
    const valid = new window.FontFace("X", "url(x.ttf)");
    assert.throws(() => {
      valid.style = "sideways";
    }, e => e.name === "SyntaxError");
  });

  specify("a local() source never loads", async () => {
    const window = await loaded();
    const face = new window.FontFace("Arial", "local(Arial)");
    assert.equal(face.status, "unloaded");
    await assert.rejects(face.load(), e => e.name === "NetworkError");
    assert.equal(face.status, "error");
  });

  specify("add, has, delete and clear on constructed faces", async () => {
    const window = await loaded();
    const set = window.document.fonts;
    const face = new window.FontFace("A", "url(a.ttf)");
    assert.equal(set.add(face), set);
    assert.equal(set.has(face), true);
    assert.deepEqual(Array.from(set.values()), [face]);
    assert.equal(set.delete(face), true);
    assert.equal(set.has(face), false);
    set.add(face);
    set.clear();
    assert.equal(set.size, 0);
  });

  specify("a loading face in the set holds ready back and fires loading and loadingdone", async () => {
    const window = await loaded();
    const set = window.document.fonts;
    const events = [];
    set.onloading = e => events.push(e.type);
    set.addEventListener("loadingdone", e => events.push(`${e.type}:${e.fontfaces.length}`));
    const face = new window.FontFace("B", TTF);
    set.add(face);
    assert.equal(set.status, "loading");
    await set.ready;
    await new Promise(r => {
      setTimeout(r, 0);
    });
    assert.equal(set.status, "loaded");
    assert.deepEqual(events, ["loading", "loadingdone:1"]);
  });

  specify("load() resolves with no faces when nothing matches", async () => {
    const window = await loaded();
    assert.deepEqual(await window.document.fonts.load("10px nothing"), []);
    await assert.rejects(window.document.fonts.load("nonsense"), e => e.name === "SyntaxError");
  });
});
