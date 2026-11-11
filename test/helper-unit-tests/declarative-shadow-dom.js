"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole } = require("../../lib/api.js");

// Declarative shadow DOM, getHTML() and the *HTMLUnsafe() parsing entry points.
// https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inhead (template start tag)
// https://html.spec.whatwg.org/multipage/parsing.html#serialising-html-fragments
// https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#html-unsafe-methods

function page(body = "") {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: "http://example.test/page.html",
    virtualConsole: new VirtualConsole()
  });
  return { window, document: window.document };
}

describe("Helpers: declarative shadow DOM", () => {
  specify("a document parsed from markup attaches a declarative shadow root and leaves no template", () => {
    const { document } = page(`<div id="host"><template shadowrootmode="open"><slot id="s"></slot></template>` +
      `<span slot="x">light</span></div>`);
    const host = document.querySelector("#host");

    assert.ok(host.shadowRoot);
    assert.equal(host.querySelector("template"), null);
    assert.equal(host.shadowRoot.querySelector("#s").localName, "slot");
    assert.equal(host.children.length, 1);
    assert.equal(host.shadowRoot.mode, "open");
    assert.equal(host.shadowRoot.serializable, false);
    assert.equal(host.shadowRoot.clonable, false);
    assert.equal(host.shadowRoot.delegatesFocus, false);
    assert.equal(host.shadowRoot.slotAssignment, "named");
  });

  specify("a closed declarative shadow root is attached but not exposed", () => {
    const { document } = page(`<div id="host"><template shadowrootmode="CLOSED"><b></b></template></div>`);
    const host = document.querySelector("#host");

    assert.equal(host.shadowRoot, null);
    assert.equal(host.querySelector("template"), null);
  });

  specify("the shadowroot* attributes set the root's flags", () => {
    const { document } = page(`<div id="host"><template shadowrootmode="open" shadowrootdelegatesfocus ` +
      `shadowrootclonable shadowrootserializable shadowrootslotassignment="manual"></template></div>`);
    const shadow = document.querySelector("#host").shadowRoot;

    assert.equal(shadow.delegatesFocus, true);
    assert.equal(shadow.clonable, true);
    assert.equal(shadow.serializable, true);
    assert.equal(shadow.slotAssignment, "manual");
  });

  specify("an invalid mode, a second root, and a host that cannot take one keep the template", () => {
    const { document } = page(`<div id="a"><template shadowrootmode="invalid"></template></div>` +
      `<div id="b"><template shadowrootmode="open">1</template><template shadowrootmode="closed">2</template></div>` +
      `<progress id="c"><template shadowrootmode="open"></template></progress>`);

    assert.equal(document.querySelector("#a").shadowRoot, null);
    assert.ok(document.querySelector("#a > template"));

    const b = document.querySelector("#b");
    assert.equal(b.shadowRoot.textContent, "1");
    assert.equal(b.children.length, 1);
    assert.equal(b.firstElementChild.content.textContent, "2");

    assert.ok(document.querySelector("#c > template"));
  });

  specify("innerHTML and DOMParser keep a shadowrootmode template as a template", () => {
    const { window, document } = page();
    const div = document.createElement("div");
    div.innerHTML = `<p><template shadowrootmode="open">x</template></p>`;

    assert.equal(div.firstChild.shadowRoot, null);
    assert.ok(div.querySelector("template"));

    const parsed = new window.DOMParser().parseFromString(
      `<p><template shadowrootmode="open">x</template></p>`,
      "text/html"
    );
    assert.equal(parsed.querySelector("p").shadowRoot, null);
    assert.ok(parsed.querySelector("template"));
  });

  specify("setHTMLUnsafe attaches declarative shadow roots, but never to its context element", () => {
    const { document } = page();
    const div = document.createElement("div");

    div.setHTMLUnsafe(`<template shadowrootmode="open">top</template>` +
      `<p id="host"><template shadowrootmode="open"><i>in</i></template>light</p>`);

    assert.equal(div.shadowRoot, null);
    assert.ok(div.querySelector(":scope > template"));
    const host = div.querySelector("#host");
    assert.equal(host.shadowRoot.innerHTML, "<i>in</i>");
    assert.equal(host.innerHTML, "light");
  });

  specify("setHTMLUnsafe on a template fills its contents, and on a shadow root replaces its children", () => {
    const { document } = page();
    const template = document.createElement("template");
    template.setHTMLUnsafe(`<b>x</b>`);
    assert.equal(template.childNodes.length, 0);
    assert.equal(template.content.firstChild.localName, "b");

    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(document.createElement("hr"));
    shadow.setHTMLUnsafe(`<span><template shadowrootmode="open">deep</template></span>`);
    assert.equal(shadow.children.length, 1);
    assert.equal(shadow.firstChild.shadowRoot.textContent, "deep");
  });

  specify("Document.parseHTMLUnsafe returns a new HTML document with declarative shadow roots", () => {
    const { window } = page();
    const doc = window.Document.parseHTMLUnsafe(`<div><template shadowrootmode="open">s</template></div>`);

    assert.ok(doc instanceof window.Document);
    assert.notEqual(doc, window.document);
    assert.equal(doc.contentType, "text/html");
    assert.equal(doc.querySelector("div").shadowRoot.textContent, "s");
    assert.equal(doc.URL, "about:blank");
  });

  specify("document.write follows the document's opt-in: a page's and parseHTMLUnsafe's, not a fresh document's", () => {
    const { window, document } = page();
    const markup = `<div id="w"><template shadowrootmode="open">s</template></div>`;

    const fresh = document.implementation.createHTMLDocument("");
    fresh.write(markup);
    assert.equal(fresh.getElementById("w").shadowRoot, null);

    const unsafe = window.Document.parseHTMLUnsafe("");
    unsafe.open();
    unsafe.write(markup);
    unsafe.close();
    assert.equal(unsafe.getElementById("w").shadowRoot.textContent, "s");
    assert.equal(unsafe.cloneNode(true).getElementById("w").shadowRoot, null);
  });

  specify("attachShadow on a declarative root empties and returns it, once, and only for the same mode", () => {
    const { window, document } = page(`<div id="host"><template shadowrootmode="open" shadowrootclonable>` +
      `<b>x</b></template></div>`);
    const host = document.querySelector("#host");
    const original = host.shadowRoot;

    assert.throws(() => host.attachShadow({ mode: "closed" }), window.DOMException);
    const returned = host.attachShadow({ mode: "open", clonable: false });
    assert.equal(returned, original);
    assert.equal(returned.childNodes.length, 0);
    assert.equal(returned.clonable, true);
    assert.throws(() => host.attachShadow({ mode: "open" }), window.DOMException);
  });

  specify("a declarative root is available to element internals", () => {
    const { document } = page(`<div id="host"><template shadowrootmode="closed"></template></div>`);
    const host = document.querySelector("#host");
    const { implSymbol } = require("../../lib/api.js");

    assert.equal(host[implSymbol]._shadowRoot._availableToElementInternals, true);
  });

  specify("getHTML serializes the shadow roots it is asked to, in the spec's attribute order", () => {
    const { document } = page();
    const wrapper = document.createElement("div");
    const host = document.createElement("section");
    wrapper.appendChild(host);
    host.innerHTML = "<span>light</span>";
    const shadow = host.attachShadow({ mode: "closed", delegatesFocus: true, clonable: true, serializable: true,
      slotAssignment: "manual" });
    shadow.innerHTML = "<slot></slot>";

    const expectedShadow = `<template shadowrootmode="closed" shadowrootdelegatesfocus="" ` +
      `shadowrootserializable="" shadowrootslotassignment="manual" shadowrootclonable=""><slot></slot></template>`;

    assert.equal(wrapper.getHTML({ serializableShadowRoots: true }),
      `<section>${expectedShadow}<span>light</span></section>`);
    assert.equal(host.getHTML({ serializableShadowRoots: true }), `${expectedShadow}<span>light</span>`);
    assert.equal(wrapper.getHTML(), wrapper.innerHTML);
    assert.equal(wrapper.getHTML({ serializableShadowRoots: false }), `<section><span>light</span></section>`);
  });

  specify("getHTML serializes a root listed in shadowRoots even when it is not serializable", () => {
    const { document } = page();
    const wrapper = document.createElement("div");
    const host = document.createElement("div");
    wrapper.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<p>&lt;in&gt;</p>";

    assert.equal(wrapper.getHTML({ serializableShadowRoots: true }), "<div></div>");
    assert.equal(wrapper.getHTML({ shadowRoots: [shadow] }),
      `<div><template shadowrootmode="open"><p>&lt;in&gt;</p></template></div>`);
  });

  specify("ShadowRoot.getHTML serializes the root's children and nested serializable roots", () => {
    const { document } = page();
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    shadow.appendChild(inner);
    inner.attachShadow({ mode: "open", serializable: true }).innerHTML = "<em>n</em>";

    assert.equal(shadow.getHTML(), "<span></span>");
    assert.equal(shadow.getHTML({ serializableShadowRoots: true }),
      `<span><template shadowrootmode="open" shadowrootserializable=""><em>n</em></template></span>`);
  });

  specify("cloning copies a clonable shadow root, for shallow clones too, and nothing else", () => {
    const { document } = page();
    const div = document.createElement("div");
    const root = div.attachShadow({ mode: "open", clonable: true, serializable: true });
    root.innerHTML = "<input><div><span></span></div>";

    const deep = div.cloneNode(true);
    assert.equal(deep.shadowRoot.clonable, true);
    assert.equal(deep.shadowRoot.serializable, true);
    assert.equal(deep.shadowRoot.innerHTML, root.innerHTML);
    assert.notEqual(deep.shadowRoot, root);

    const shallow = div.cloneNode(false);
    assert.equal(shallow.shadowRoot.innerHTML, root.innerHTML);

    const plain = document.createElement("div");
    plain.attachShadow({ mode: "open" }).innerHTML = "<b></b>";
    assert.equal(plain.cloneNode(true).shadowRoot, null);
  });

  specify("a clonable declarative root inside template contents survives cloning the contents", () => {
    const { document } = page(`<template id="t"><div class="inner"><template shadowrootmode="open" ` +
      `shadowrootclonable>Content</template></div></template>`);
    const template = document.querySelector("#t");

    assert.ok(template.content.querySelector(".inner").shadowRoot);
    const clone = template.content.cloneNode(true);
    assert.equal(clone.querySelector(".inner").shadowRoot.textContent, "Content");
    assert.equal(clone.querySelector(".inner > template"), null);

    const imported = document.importNode(template.content, true);
    assert.equal(imported.querySelector(".inner").shadowRoot.textContent, "Content");
  });
});
