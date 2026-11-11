"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// IDL attributes that reflect a content attribute, as html/dom/reflection-*.html
// checks them: the IDL attribute exists with the right type, a get reads the
// content attribute through the reflection type's rules, and a set writes it.
// Only the reflection is implemented; what the attribute means to the user agent
// (focusing an autofocus element, making an inert subtree unreachable, showing a
// popover) is not.
describe("Helpers: reflected IDL attributes", () => {
  const { window } = new JSDOM(`<form id="f" autocapitalize="words"><input id="i"></form>`, {
    url: "https://example.com/dir/page.html"
  });
  const { document } = window;
  const make = name => document.createElement(name);

  describe("global attributes on HTMLElement", () => {
    specify("autofocus and inert are boolean attributes, on unknown elements too", () => {
      for (const name of ["div", "img", "undefinedelement"]) {
        const el = make(name);
        assert.equal(el.autofocus, false);
        assert.equal(el.inert, false);
        el.setAttribute("autofocus", "no");
        el.setAttribute("inert", "");
        assert.equal(el.autofocus, true);
        assert.equal(el.inert, true);
        el.autofocus = false;
        assert.equal(el.hasAttribute("autofocus"), false);
      }
    });

    specify("autofocus is on SVG elements as well", () => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      assert.equal(el.autofocus, false);
      el.autofocus = true;
      assert.equal(el.getAttribute("autofocus"), "");
    });

    specify("enterKeyHint and inputMode are enumerated, with no missing or invalid default", () => {
      const el = make("undefinedelement");
      assert.equal(el.enterKeyHint, "");
      assert.equal(el.inputMode, "");
      el.setAttribute("enterkeyhint", "DONE");
      el.setAttribute("inputmode", "Numeric");
      assert.equal(el.enterKeyHint, "done");
      assert.equal(el.inputMode, "numeric");
      el.setAttribute("enterkeyhint", "bogus");
      assert.equal(el.enterKeyHint, "");
      el.inputMode = " email ";
      assert.equal(el.getAttribute("inputmode"), " email ");
      assert.equal(el.inputMode, "");
    });

    specify("autocapitalize maps on/off to their states and inherits from the form owner", () => {
      const el = make("div");
      assert.equal(el.autocapitalize, "");
      el.setAttribute("autocapitalize", "off");
      assert.equal(el.autocapitalize, "none");
      el.setAttribute("autocapitalize", "on");
      assert.equal(el.autocapitalize, "sentences");
      el.setAttribute("autocapitalize", "bogus");
      assert.equal(el.autocapitalize, "sentences");
      el.autocapitalize = "CHARACTERS";
      assert.equal(el.getAttribute("autocapitalize"), "CHARACTERS");
      assert.equal(el.autocapitalize, "characters");

      const input = document.getElementById("i");
      assert.equal(input.autocapitalize, "words");
      assert.equal(make("input").autocapitalize, "");
    });

    specify("writingSuggestions is true unless the element or an ancestor says false", () => {
      const outer = make("div");
      const inner = make("span");
      outer.append(inner);
      assert.equal(inner.writingSuggestions, "true");
      outer.setAttribute("writingsuggestions", "FALSE");
      assert.equal(inner.writingSuggestions, "false");
      inner.setAttribute("writingsuggestions", "");
      assert.equal(inner.writingSuggestions, "true");
      inner.writingSuggestions = "false";
      assert.equal(inner.getAttribute("writingsuggestions"), "false");
    });

    specify("spellcheck is inherited, true by default", () => {
      const outer = make("div");
      const inner = make("span");
      outer.append(inner);
      assert.equal(inner.spellcheck, true);
      outer.setAttribute("spellcheck", "false");
      assert.equal(inner.spellcheck, false);
      inner.spellcheck = true;
      assert.equal(inner.getAttribute("spellcheck"), "true");
      assert.equal(inner.spellcheck, true);
    });

    specify("popover is a nullable enumerated attribute", () => {
      const el = make("div");
      assert.equal(el.popover, null);
      el.setAttribute("popover", "");
      assert.equal(el.popover, "auto");
      el.setAttribute("popover", "MANUAL");
      assert.equal(el.popover, "manual");
      el.setAttribute("popover", "hint");
      assert.equal(el.popover, "hint");
      el.setAttribute("popover", "bogus");
      assert.equal(el.popover, "manual");
      el.popover = null;
      assert.equal(el.hasAttribute("popover"), false);
    });

    specify("nonce is set from the content attribute, but setting it does not write the attribute", () => {
      const el = make("link");
      assert.equal(el.nonce, "");
      el.setAttribute("nonce", "abc");
      assert.equal(el.nonce, "abc");
      el.nonce = "xyz";
      assert.equal(el.nonce, "xyz");
      assert.equal(el.getAttribute("nonce"), "abc");
      el.removeAttribute("nonce");
      assert.equal(el.nonce, "");
    });

    specify("tabIndex parses with the rules for parsing integers", () => {
      const el = make("div");
      assert.equal(el.tabIndex, -1);
      el.setAttribute("tabindex", "5%");
      assert.equal(el.tabIndex, 5);
      el.setAttribute("tabindex", "bogus");
      assert.equal(el.tabIndex, -1);
      el.setAttribute("tabindex", "2147483648");
      assert.equal(el.tabIndex, -1);
      const a = make("button");
      a.setAttribute("tabindex", "x");
      assert.equal(a.tabIndex, 0);
    });
  });

  describe("element-specific attributes", () => {
    specify("crossOrigin is nullable, the empty string is anonymous, an invalid value is anonymous", () => {
      for (const name of ["img", "link", "script", "video", "audio"]) {
        const el = make(name);
        assert.equal(el.crossOrigin, null, name);
        el.setAttribute("crossorigin", "");
        assert.equal(el.crossOrigin, "anonymous", name);
        el.setAttribute("crossorigin", "USE-CREDENTIALS");
        assert.equal(el.crossOrigin, "use-credentials", name);
        el.setAttribute("crossorigin", "bogus");
        assert.equal(el.crossOrigin, "anonymous", name);
        el.crossOrigin = null;
        assert.equal(el.hasAttribute("crossorigin"), false, name);
      }
    });

    specify("referrerPolicy is enumerated with no state for an invalid value", () => {
      for (const name of ["a", "area", "img", "iframe", "link", "script"]) {
        const el = make(name);
        assert.equal(el.referrerPolicy, "", name);
        el.setAttribute("referrerpolicy", "No-Referrer");
        assert.equal(el.referrerPolicy, "no-referrer", name);
        el.setAttribute("referrerpolicy", "bogus");
        assert.equal(el.referrerPolicy, "", name);
      }
    });

    specify("img decoding, media preload and loading, track kind", () => {
      const img = make("img");
      assert.equal(img.decoding, "auto");
      img.setAttribute("decoding", "ASYNC");
      assert.equal(img.decoding, "async");
      img.setAttribute("decoding", "x");
      assert.equal(img.decoding, "auto");

      const video = make("video");
      assert.equal(video.preload, "metadata");
      video.setAttribute("preload", "");
      assert.equal(video.preload, "auto");
      video.setAttribute("preload", "NONE");
      assert.equal(video.preload, "none");
      assert.equal(video.loading, "eager");
      video.setAttribute("loading", "lazy");
      assert.equal(video.loading, "lazy");
      assert.equal(make("audio").loading, "eager");

      const track = make("track");
      assert.equal(track.kind, "subtitles");
      track.setAttribute("kind", "x");
      assert.equal(track.kind, "metadata");
      track.setAttribute("kind", "Captions");
      assert.equal(track.kind, "captions");
    });

    specify("a and area: ping, download, hreflang, type", () => {
      const area = make("area");
      for (const [idl, content] of [["ping", "ping"], ["download", "download"], ["hreflang", "hreflang"],
        ["type", "type"]]) {
        assert.equal(area[idl], "");
        area[idl] = "v";
        assert.equal(area.getAttribute(content), "v");
      }
      const a = make("a");
      a.ping = "x";
      assert.equal(a.getAttribute("ping"), "x");
    });

    specify("link as, integrity; script noModule, integrity; meta media", () => {
      const link = make("link");
      assert.equal(link.as, "");
      link.setAttribute("as", "SCRIPT");
      assert.equal(link.as, "script");
      link.setAttribute("as", "bogus");
      assert.equal(link.as, "");
      link.integrity = "sha256-x";
      assert.equal(link.getAttribute("integrity"), "sha256-x");

      const script = make("script");
      assert.equal(script.noModule, false);
      script.noModule = true;
      assert.equal(script.getAttribute("nomodule"), "");
      script.integrity = "i";
      assert.equal(script.getAttribute("integrity"), "i");

      const meta = make("meta");
      meta.media = "print";
      assert.equal(meta.getAttribute("media"), "print");
    });

    specify("form autocomplete and encoding; select autocomplete", () => {
      const form = make("form");
      assert.equal(form.autocomplete, "on");
      form.setAttribute("autocomplete", "OFF");
      assert.equal(form.autocomplete, "off");
      form.setAttribute("autocomplete", "x");
      assert.equal(form.autocomplete, "on");
      assert.equal(form.encoding, "application/x-www-form-urlencoded");
      form.encoding = "text/plain";
      assert.equal(form.getAttribute("enctype"), "text/plain");
      assert.equal(form.enctype, "text/plain");

      const select = make("select");
      assert.equal(select.autocomplete, "");
      select.autocomplete = "off";
      assert.equal(select.getAttribute("autocomplete"), "off");
    });

    specify("input and button: formAction, formEnctype, formMethod", () => {
      for (const name of ["input", "button"]) {
        const el = make(name);
        assert.equal(el.formAction, "https://example.com/dir/page.html", name);
        el.setAttribute("formaction", "next");
        assert.equal(el.formAction, "https://example.com/dir/next", name);
        assert.equal(el.formEnctype, "", name);
        el.setAttribute("formenctype", "x");
        assert.equal(el.formEnctype, "application/x-www-form-urlencoded", name);
        el.setAttribute("formenctype", "MULTIPART/form-data");
        assert.equal(el.formEnctype, "multipart/form-data", name);
        assert.equal(el.formMethod, "", name);
        el.setAttribute("formmethod", "x");
        assert.equal(el.formMethod, "get", name);
        el.setAttribute("formmethod", "POST");
        assert.equal(el.formMethod, "post", name);
      }
      const button = make("button");
      button.setAttribute("formmethod", "dialog");
      assert.equal(button.formMethod, "dialog");
    });

    specify("button type sets the content attribute as given", () => {
      const button = make("button");
      button.type = "bogus";
      assert.equal(button.getAttribute("type"), "bogus");
      assert.equal(button.type, "submit");
      button.type = "";
      assert.equal(button.getAttribute("type"), "");
    });

    specify("unsigned long limits: input and img width/height, canvas, marquee", () => {
      const input = make("input");
      assert.equal(typeof input.width, "number");
      input.width = 7;
      assert.equal(input.getAttribute("width"), "7");
      input.height = 2147483648;
      assert.equal(input.getAttribute("height"), "0");

      const img = make("img");
      img.width = 2147483648;
      assert.equal(img.getAttribute("width"), "0");

      const canvas = make("canvas");
      canvas.setAttribute("width", "\v7");
      assert.equal(canvas.width, 300);
      canvas.setAttribute("height", "-0");
      assert.equal(canvas.height, 0);

      const marquee = make("marquee");
      assert.equal(marquee.scrollAmount, 6);
      assert.equal(marquee.scrollDelay, 85);
    });

    specify("ol start is a long whose default is 1", () => {
      const ol = make("ol");
      assert.equal(ol.start, 1);
      ol.setAttribute("start", "2147483648");
      assert.equal(ol.start, 1);
      ol.setAttribute("start", " -3x");
      assert.equal(ol.start, -3);
    });
  });
});
