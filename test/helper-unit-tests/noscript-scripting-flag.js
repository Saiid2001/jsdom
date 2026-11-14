"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// Scripting is disabled for a node whose document has no browsing context:
// template contents, createHTMLDocument(), DOMParser and XHR documents. There
// the parser reads <noscript> as markup and the serializer escapes its text,
// while a document scripts run in reads it as raw text and writes it back
// verbatim.
// https://html.spec.whatwg.org/multipage/webappapis.html#concept-n-noscript
// https://html.spec.whatwg.org/multipage/parsing.html#serialising-html-fragments

const ESCAPED = "&amp;&nbsp;&lt;&gt;";
const UNESCAPED = "&\u00A0<>";

function scripted(html = "") {
  return new JSDOM(`<!DOCTYPE html><body>${html}`, { runScripts: "dangerously" }).window;
}

describe("Helpers: the scripting flag of documents with no browsing context", () => {
  specify("a document scripts run in keeps <noscript> raw", () => {
    const window = scripted();
    const div = window.document.createElement("div");

    div.innerHTML = `<noscript>${UNESCAPED}</noscript>`;
    assert.equal(div.firstChild.textContent, UNESCAPED);
    assert.equal(div.firstChild.innerHTML, UNESCAPED);
  });

  specify("template.innerHTML parses <noscript> with scripting disabled", () => {
    const window = scripted();
    const template = window.document.createElement("template");

    template.innerHTML = `<noscript>${ESCAPED}</noscript>`;
    const noscript = template.content.firstChild;
    assert.equal(noscript.textContent, UNESCAPED);
    assert.equal(noscript.innerHTML, ESCAPED);
  });

  specify("<noscript> parsed into a template by the page escapes when serialized", () => {
    const window = scripted(`<template><noscript><div></div></noscript></template>`);
    const noscript = window.document.querySelector("template").content.firstChild;

    assert.equal(noscript.textContent, "<div></div>");
    assert.equal(noscript.innerHTML, "&lt;div&gt;&lt;/div&gt;");
  });

  specify("createHTMLDocument() parses and serializes with scripting disabled", () => {
    const window = scripted();
    const doc = window.document.implementation.createHTMLDocument("");

    doc.body.innerHTML = `<pre><noscript>${ESCAPED}</noscript></pre>`;
    const noscript = doc.body.firstChild.firstChild;
    assert.equal(noscript.textContent, UNESCAPED);
    assert.equal(noscript.innerHTML, ESCAPED);
  });

  specify("createContextualFragment() in a createHTMLDocument() document", () => {
    const window = scripted();
    const doc = window.document.implementation.createHTMLDocument("");
    const range = doc.createRange();

    range.selectNode(doc.body);
    const noscript = range.createContextualFragment(`<noscript>${ESCAPED}</noscript>`).firstChild;
    assert.equal(noscript.textContent, UNESCAPED);
    assert.equal(noscript.innerHTML, ESCAPED);
  });

  specify("document.write() into a createHTMLDocument() document", () => {
    const window = scripted();
    const doc = window.document.implementation.createHTMLDocument("");

    doc.write(`<div id="w"><noscript>${UNESCAPED}</noscript></div>`);
    const noscript = doc.getElementById("w").firstChild;
    assert.equal(noscript.innerHTML, ESCAPED);
  });

  specify("a document without a browsing context leaves the page's own flag alone", () => {
    const window = scripted();
    window.document.implementation.createHTMLDocument("");
    new window.DOMParser().parseFromString("<p>", "text/html");

    const div = window.document.createElement("div");
    div.innerHTML = `<noscript>${UNESCAPED}</noscript>`;
    assert.equal(div.firstChild.innerHTML, UNESCAPED);
  });
});
