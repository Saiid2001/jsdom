"use strict";
const whatwgURL = require("whatwg-url");
const idlUtils = require("../generated/utils");
const referrerPolicy = require("../helpers/referrer-policy");
const { cssURLRequest } = require("../helpers/stylesheets");
const DOMException = require("../generated/DOMException");
const { documentBaseURL } = require("../helpers/document-base-url");
const { consumePreloadedResource } = require("../helpers/preload");

// CSS Font Loading: FontFace, FontFaceSet, FontFaceSetLoadEvent and document.fonts.
// https://drafts.csswg.org/css-font-loading/
//
// Hand-written rather than generated: FontFaceSet is setlike, which webidl2js does not support.
//
// Nothing here reads the host's fonts. A face's bytes are fetched through the window's resource loader, the path every
// other subresource takes, and only checked for a font file's signature; they are not handed to a rasterizer. local()
// sources never match: which fonts a machine has installed is a fingerprint, so to a page none are.

const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "default"]);

const FONT_SIGNATURES = [
  [0x00, 0x01, 0x00, 0x00], // TrueType
  [0x4F, 0x54, 0x54, 0x4F], // "OTTO"
  [0x74, 0x72, 0x75, 0x65], // "true"
  [0x74, 0x79, 0x70, 0x31], // "typ1"
  [0x74, 0x74, 0x63, 0x66], // "ttcf"
  [0x77, 0x4F, 0x46, 0x46], // "wOFF"
  [0x77, 0x4F, 0x46, 0x32] // "wOF2"
];

function isFontData(bytes) {
  return bytes && bytes.length >= 4 && FONT_SIGNATURES.some(sig => sig.every((b, i) => bytes[i] === b));
}

function bytesOf(source) {
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  }
  return new Uint8Array(source).slice();
}

function isBufferSource(value) {
  return ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) === "[object ArrayBuffer]" ||
    Object.prototype.toString.call(value) === "[object SharedArrayBuffer]";
}

// Splits on commas at the top level, outside quotes and parentheses.
function splitTopLevel(text, separator = ",") {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") {
        i++;
      } else if (c === quote) {
        quote = null;
      }
    } else if (c === "\"" || c === "'") {
      quote = c;
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));

  return quote || depth !== 0 ? null : parts;
}

function unquote(text) {
  const t = text.trim();
  if (t.length >= 2 && (t[0] === "\"" || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return null;
}

// <family-name>: one string, or a run of identifiers. Answers the name, or null.
function parseFamilyName(text) {
  const t = text.trim();
  const quoted = unquote(t);
  if (quoted !== null) {
    return quoted;
  }
  const words = t.split(/\s+/);
  if (!t || !words.every(w => /^-?(?:[a-zA-Z_\u0080-￿]|\\.)(?:[\w\-\u0080-￿]|\\.)*$/.test(w))) {
    return null;
  }
  if (words.length === 1 && CSS_WIDE_KEYWORDS.has(words[0].toLowerCase())) {
    return null;
  }
  return words.join(" ");
}

function parseUnicodeRange(text) {
  const ranges = [];
  for (const part of text.split(",")) {
    const m = /^\s*u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!m) {
      return null;
    }
    let start,
      end;
    if (m[1].includes("?")) {
      if (m[2] || !/^[0-9a-f]*\?+$/i.test(m[1])) {
        return null;
      }
      start = parseInt(m[1].replace(/\?/g, "0"), 16);
      end = parseInt(m[1].replace(/\?/g, "F"), 16);
    } else {
      start = parseInt(m[1], 16);
      end = m[2] ? parseInt(m[2], 16) : start;
    }
    if (start > 0x10FFFF || end < start) {
      return null;
    }
    ranges.push([start, Math.min(end, 0x10FFFF)]);
  }
  return ranges;
}

const NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?";
const ANGLE = `${NUMBER}(?:deg|grad|rad|turn)`;

const STRETCH_KEYWORD = new RegExp("^(?:normal|ultra-condensed|extra-condensed|condensed|semi-condensed|" +
  "semi-expanded|expanded|extra-expanded|ultra-expanded)$", "i");
const PERCENTAGE = new RegExp(`^${NUMBER}%$`);
const FEATURE = /^\s*(?:"[\x20-\x7E]{4}"|'[\x20-\x7E]{4}')(?:\s+(?:\d+|on|off))?\s*$/i;
const VARIATION = new RegExp(`^\\s*(?:"[\\x20-\\x7E]{4}"|'[\\x20-\\x7E]{4}')\\s+${NUMBER}\\s*$`, "i");
const FONT_SIZE = new RegExp(`(?:^|\\s)(?:${NUMBER}(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)|0|` +
  "xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)" +
  `(?:\\s*\\/\\s*(?:normal|${NUMBER}[a-z%]*))?\\s+`, "i");
const FONT_PREFIX_WORD = new RegExp("^(?:normal|italic|oblique|small-caps|bold|bolder|lighter|\\d{1,4}|" +
  "(?:ultra-|extra-|semi-)?(?:condensed|expanded))$", "i");

const DESCRIPTORS = {
  style: v => new RegExp(`^(?:normal|italic|oblique(?:\\s+${ANGLE}(?:\\s+${ANGLE})?)?)$`, "i").test(v),
  weight: v => /^(?:normal|bold)$/i.test(v) || (new RegExp(`^${NUMBER}(?:\\s+${NUMBER})?$`, "i").test(v) &&
    v.split(/\s+/).every(n => Number(n) >= 1 && Number(n) <= 1000)),
  stretch: v => v.split(/\s+/).length <= 2 &&
    v.split(/\s+/).every(w => STRETCH_KEYWORD.test(w) || (PERCENTAGE.test(w) && parseFloat(w) >= 0)),
  unicodeRange: v => parseUnicodeRange(v) !== null,
  featureSettings: v => /^normal$/i.test(v) || (splitTopLevel(v) || [""]).every(f => FEATURE.test(f)),
  variationSettings: v => /^normal$/i.test(v) || (splitTopLevel(v) || [""]).every(f => VARIATION.test(f)),
  display: v => /^(?:auto|block|swap|fallback|optional)$/i.test(v),
  ascentOverride: v => /^normal$/i.test(v) || (new RegExp(`^${NUMBER}%$`).test(v) && parseFloat(v) >= 0),
  descentOverride: v => /^normal$/i.test(v) || (new RegExp(`^${NUMBER}%$`).test(v) && parseFloat(v) >= 0),
  lineGapOverride: v => /^normal$/i.test(v) || (new RegExp(`^${NUMBER}%$`).test(v) && parseFloat(v) >= 0)
};

const DESCRIPTOR_DEFAULTS = {
  style: "normal",
  weight: "normal",
  stretch: "normal",
  unicodeRange: "U+0-10FFFF",
  featureSettings: "normal",
  variationSettings: "normal",
  display: "auto",
  ascentOverride: "normal",
  descentOverride: "normal",
  lineGapOverride: "normal"
};

// The @font-face property each descriptor is read from.
const CSS_DESCRIPTORS = {
  style: "font-style",
  weight: "font-weight",
  stretch: "font-stretch",
  unicodeRange: "unicode-range",
  featureSettings: "font-feature-settings",
  variationSettings: "font-variation-settings",
  display: "font-display",
  ascentOverride: "ascent-override",
  descentOverride: "descent-override",
  lineGapOverride: "line-gap-override"
};

// <font-src-list>: answers [{ url } | { local }], or null where it does not parse.
function parseSourceList(text) {
  const items = splitTopLevel(text);
  if (!items) {
    return null;
  }
  const sources = [];
  for (const item of items) {
    const t = item.trim();
    const url = /^url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s"']*))\s*\)/i.exec(t);
    const local = /^local\(\s*([^)]*)\)\s*$/i.exec(t);
    if (url) {
      const rest = t.slice(url[0].length).trim();
      if (rest && !/^(?:(?:format|tech)\([^)]*\)\s*)+$/i.test(rest)) {
        return null;
      }
      sources.push({ url: (url[1] ?? url[2] ?? url[3]).replace(/\\(.)/g, "$1") });
    } else if (local) {
      if (parseFamilyName(local[1]) === null) {
        return null;
      }
      sources.push({ local: true });
    } else {
      return null;
    }
  }
  return sources.length ? sources : null;
}

// The `font` shorthand, as far as matching needs it: the family list. Answers null for a syntax error.
function parseFontShorthand(text) {
  const t = String(text).trim();
  if (!t || CSS_WIDE_KEYWORDS.has(t.toLowerCase())) {
    return null;
  }
  const m = FONT_SIZE.exec(t);
  if (!m) {
    return null;
  }
  const prefix = t.slice(0, m.index).trim();
  if (prefix && !prefix.split(/\s+/).every(w => FONT_PREFIX_WORD.test(w))) {
    return null;
  }
  const families = splitTopLevel(t.slice(m.index + m[0].length));
  if (!families) {
    return null;
  }
  const names = families.map(parseFamilyName);
  return names.every(n => n !== null) ? { families: names, italic: /\b(?:italic|oblique)\b/i.test(prefix) } : null;
}

function rejectedWith(window, name, message) {
  const promise = Promise.reject(DOMException.create(window, [message, name]));
  promise.catch(() => {});
  return promise;
}

module.exports = function installFontLoading(window) {
  const faceState = new WeakMap();
  const setState = new WeakMap();

  function face(object) {
    const state = faceState.get(object);
    if (!state) {
      throw new TypeError("Illegal invocation");
    }
    return state;
  }

  function set(object) {
    const state = setState.get(object);
    if (!state) {
      throw new TypeError("Illegal invocation");
    }
    return state;
  }

  // ### FontFaceSetLoadEvent

  const fontfacesOf = new WeakMap();

  class FontFaceSetLoadEvent extends window.Event {
    constructor(type, eventInitDict = {}) {
      if (arguments.length < 1) {
        throw new TypeError("Failed to construct 'FontFaceSetLoadEvent': 1 argument required, but only 0 present.");
      }
      super(type, eventInitDict);
      const faces = eventInitDict && eventInitDict.fontfaces !== undefined ? Array.from(eventInitDict.fontfaces) : [];
      for (const f of faces) {
        face(f);
      }
      fontfacesOf.set(this, Object.freeze(faces));
    }

    get fontfaces() {
      if (!fontfacesOf.has(this)) {
        throw new TypeError("Illegal invocation");
      }
      return fontfacesOf.get(this);
    }
  }

  // ### FontFace

  function settle(f, state, error) {
    if (error) {
      state.status = "error";
      state.reject(error);
    } else {
      state.status = "loaded";
      state.resolve(f);
    }
    for (const owner of state.sets) {
      faceSettled(owner, f, Boolean(error));
    }
  }

  function startLoading(f, state) {
    state.status = "loading";
    for (const owner of state.sets) {
      faceLoading(owner, f);
    }
  }

  // A face a style sheet declared is fetched from that sheet, under its policy
  // (cssURLRequest); one script made, from the document.
  function fetchFontURL(url, raw) {
    const loader = window._resourceLoader;
    const document = idlUtils.implForWrapper(window._document);
    if (!loader) {
      return Promise.reject(new Error("no resource loader"));
    }
    const declared = document && raw ? cssURLRequest(document, raw) : null;
    // A font is fetched "cors", with the credentials of crossorigin="anonymous",
    // which is what a <link rel=preload as=font crossorigin> is made with.
    // https://drafts.csswg.org/css-fonts/#font-fetching-requirements
    const request = consumePreloadedResource(document, url, {
      destination: "font",
      mode: "cors",
      credentials: "same-origin"
    }) || loader.fetch(url, {
      cookieJar: document && document._cookieJar,
      referrer: declared && declared.url === url ? declared.referrer : document && document.URL,
      referrerPolicy: declared && declared.url === url ?
        declared.referrerPolicy :
        referrerPolicy.documentPolicy(document)
    });
    if (!request) {
      return Promise.reject(new Error("refused"));
    }
    return Promise.resolve(request).then(data => {
      const status = request.response ? request.response.statusCode : undefined;
      if (typeof status === "number" && (status < 200 || status > 299)) {
        throw new Error(`status ${status}`);
      }
      return data;
    });
  }

  // Tries each source in turn; local() never matches.
  async function loadSources(sources, baseURL) {
    for (const source of sources) {
      if (!source.url) {
        continue;
      }
      const parsed = whatwgURL.parseURL(source.url, { baseURL });
      if (parsed === null) {
        continue;
      }
      try {
        const data = await fetchFontURL(whatwgURL.serializeURL(parsed), source.url);
        if (isFontData(data)) {
          return true;
        }
      } catch {
        // The next source, as a browser does.
      }
    }
    return false;
  }

  function makeFaceState(f) {
    const state = {
      status: "unloaded",
      sets: new Set(),
      cssConnected: false,
      sources: null,
      baseURL: null,
      data: null
    };
    state.promise = new Promise((resolve, reject) => {
      state.resolve = resolve;
      state.reject = reject;
    });
    state.promise.catch(() => {});
    faceState.set(f, state);
    return state;
  }

  class FontFace {
    constructor(family, source, descriptors = {}) {
      if (arguments.length < 2) {
        throw new TypeError("Failed to construct 'FontFace': 2 arguments required.");
      }
      const state = makeFaceState(this);
      const document = idlUtils.implForWrapper(window._document);
      state.baseURL = document ? documentBaseURL(document) : null;

      const familyName = parseFamilyName(String(family));
      const values = {};
      let valid = familyName !== null;
      for (const name of Object.keys(DESCRIPTORS)) {
        const given = descriptors && descriptors[name] !== undefined ? String(descriptors[name]).trim() : undefined;
        if (given !== undefined && !DESCRIPTORS[name](given)) {
          valid = false;
        }
        values[name] = given ?? DESCRIPTOR_DEFAULTS[name];
      }

      if (isBufferSource(source)) {
        state.data = bytesOf(source);
      } else {
        state.sources = parseSourceList(String(source));
        if (state.sources === null) {
          valid = false;
        }
      }

      if (!valid) {
        state.family = "";
        for (const name of Object.keys(DESCRIPTORS)) {
          state[name] = "";
        }
        state.status = "error";
        state.reject(DOMException.create(window, [
          "Failed to construct 'FontFace': a value does not parse.",
          "SyntaxError"
        ]));
        return;
      }

      state.family = familyName;
      Object.assign(state, values);

      if (state.data) {
        startLoading(this, state);
        const { data } = state;
        queueMicrotask(() => {
          settle(this, state, isFontData(data) ?
null :
            DOMException.create(window, ["The font data could not be parsed.", "SyntaxError"]));
        });
      }
    }

    get family() {
      return face(this).family;
    }

    set family(value) {
      const name = parseFamilyName(String(value));
      if (name === null) {
        throw DOMException.create(window, ["Failed to set 'family': it does not parse.", "SyntaxError"]);
      }
      face(this).family = name;
    }

    get status() {
      return face(this).status;
    }

    get loaded() {
      return face(this).promise;
    }

    load() {
      const state = face(this);
      if (state.sources === null || state.status !== "unloaded") {
        return state.promise;
      }
      startLoading(this, state);
      loadSources(state.sources, state.baseURL).then(ok => {
        settle(this, state, ok ?
null :
          DOMException.create(window, ["The font could not be loaded.", "NetworkError"]));
      });
      return state.promise;
    }
  }

  for (const name of Object.keys(DESCRIPTORS)) {
    Object.defineProperty(FontFace.prototype, name, {
      configurable: true,
      enumerable: true,
      get() {
        return face(this)[name];
      },
      set(value) {
        const text = String(value).trim();
        if (!DESCRIPTORS[name](text)) {
          throw DOMException.create(window, [`Failed to set '${name}': it does not parse.`, "SyntaxError"]);
        }
        face(this)[name] = text;
      }
    });
  }

  // A face made from an @font-face rule. Answers null for a rule with no family or no usable source.
  function cssConnectedFace(rule, baseURL) {
    const { style } = rule;
    const family = style && parseFamilyName(style.getPropertyValue("font-family") || "");
    const sources = style && parseSourceList(style.getPropertyValue("src") || "");
    if (!family || !sources) {
      return null;
    }
    const f = Object.create(FontFace.prototype);
    const state = makeFaceState(f);
    state.cssConnected = true;
    state.family = family;
    state.sources = sources;
    state.baseURL = baseURL;
    for (const [name, property] of Object.entries(CSS_DESCRIPTORS)) {
      const value = (style.getPropertyValue(property) || "").trim();
      state[name] = value && DESCRIPTORS[name](value) ? value : DESCRIPTOR_DEFAULTS[name];
    }
    return f;
  }

  // ### FontFaceSet

  class FontFaceSet extends window.EventTarget {
    constructor(initialFaces = []) {
      super();
      const state = {
        faces: new Set(),
        document: null,
        cssFaces: new Map(),
        loading: new Set(),
        loaded: [],
        failed: [],
        status: "loaded",
        handlers: Object.create(null)
      };
      setState.set(this, state);
      state.ready = Promise.resolve(this);
      state.readyFulfilled = true;
      for (const f of Array.from(initialFaces)) {
        face(f);
        this.add(f);
      }
    }

    get status() {
      return set(this).status;
    }

    get ready() {
      return set(this).ready;
    }

    get size() {
      return entriesOf(this).length;
    }

    has(font) {
      return entriesOf(this).includes(font);
    }

    add(font) {
      const state = set(this);
      const fstate = face(font);
      if (fstate.cssConnected) {
        throw DOMException.create(window, ["A CSS-connected FontFace cannot be added.", "InvalidModificationError"]);
      }
      if (state.faces.has(font)) {
        return this;
      }
      state.faces.add(font);
      fstate.sets.add(this);
      if (fstate.status === "loading") {
        faceLoading(this, font);
      }
      return this;
    }

    delete(font) {
      const state = set(this);
      const fstate = face(font);
      if (fstate.cssConnected) {
        return false;
      }
      if (!state.faces.delete(font)) {
        return false;
      }
      fstate.sets.delete(this);
      if (state.loading.delete(font) && state.loading.size === 0) {
        switchToLoaded(this);
      }
      return true;
    }

    clear() {
      const state = set(this);
      for (const f of state.faces) {
        faceState.get(f).sets.delete(this);
      }
      state.faces.clear();
      if (state.loading.size) {
        state.loading.clear();
        switchToLoaded(this);
      }
    }

    entries() {
      return entriesOf(this).map(f => [f, f])[Symbol.iterator]();
    }

    values() {
      return entriesOf(this)[Symbol.iterator]();
    }

    forEach(callback, thisArg) {
      if (typeof callback !== "function") {
        throw new TypeError("The callback provided as parameter 1 is not a function.");
      }
      for (const f of entriesOf(this)) {
        callback.call(thisArg, f, f, this);
      }
    }

    load(font, text = " ") {
      let matched;
      try {
        set(this);
        matched = matchingFaces(this, font, text);
      } catch (error) {
        return Promise.reject(error);
      }
      if (matched === null) {
        return rejectedWith(window, "SyntaxError", "The font does not parse.");
      }
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          Promise.all(matched.map(f => f.load())).then(resolve, reject);
        }, 0);
      });
    }

    check(font, text = " ") {
      set(this);
      const matched = matchingFaces(this, font, text);
      if (matched === null) {
        throw DOMException.create(window, ["The font does not parse.", "SyntaxError"]);
      }
      return matched.every(f => {
        const { status } = faceState.get(f);
        return status === "loaded" || status === "error";
      });
    }
  }

  Object.defineProperty(FontFaceSet.prototype, "keys", {
    configurable: true,
    writable: true,
    value: FontFaceSet.prototype.values
  });
  Object.defineProperty(FontFaceSet.prototype, Symbol.iterator, {
    configurable: true,
    writable: true,
    value: FontFaceSet.prototype.values
  });

  for (const type of ["loading", "loadingdone", "loadingerror"]) {
    Object.defineProperty(FontFaceSet.prototype, `on${type}`, {
      configurable: true,
      enumerable: true,
      get() {
        return set(this).handlers[type] || null;
      },
      set(value) {
        const state = set(this);
        const handler = typeof value === "function" || (value !== null && typeof value === "object") ? value : null;
        if (!state.handlers[type] && handler) {
          this.addEventListener(type, event => {
            const current = state.handlers[type];
            if (typeof current === "function") {
              current.call(this, event);
            }
          });
        }
        state.handlers[type] = handler;
      }
    });
  }

  function faceLoading(target, f) {
    const state = set(target);
    if (state.loading.size === 0) {
      switchToLoading(target);
    }
    state.loading.add(f);
  }

  function faceSettled(target, f, failed) {
    const state = set(target);
    if (!state.loading.delete(f)) {
      return;
    }
    (failed ? state.failed : state.loaded).push(f);
    if (state.loading.size === 0) {
      switchToLoaded(target);
    }
  }

  // The document stopped loading: a set held back by it can settle now.
  function environmentSettled(target) {
    const state = set(target);
    if (state.stuck && state.loading.size === 0) {
      state.stuck = false;
      switchToLoaded(target);
    }
  }

  function pendingOnEnvironment(state) {
    return Boolean(state.document && state.document.readyState !== "complete");
  }

  function switchToLoading(target) {
    const state = set(target);
    state.status = "loading";
    if (state.readyFulfilled) {
      state.readyFulfilled = false;
      state.ready = new Promise(resolve => {
        state.resolveReady = resolve;
      });
    }
    queueMicrotask(() => target.dispatchEvent(new FontFaceSetLoadEvent("loading")));
  }

  function switchToLoaded(target) {
    const state = set(target);
    if (pendingOnEnvironment(state)) {
      state.stuck = true;
      return;
    }
    state.status = "loaded";
    const { loaded } = state;
    const { failed } = state;
    state.loaded = [];
    state.failed = [];
    if (!state.readyFulfilled) {
      state.readyFulfilled = true;
      state.resolveReady(target);
    }
    if (loaded.length || failed.length) {
      queueMicrotask(() => {
        target.dispatchEvent(new FontFaceSetLoadEvent("loadingdone", { fontfaces: loaded }));
        if (failed.length) {
          target.dispatchEvent(new FontFaceSetLoadEvent("loadingerror", { fontfaces: failed }));
        }
      });
    }
  }

  // The document's CSS-connected faces, in document order, made once per rule.
  function cssFacesOf(state) {
    const { document } = state;
    if (!document) {
      return [];
    }
    const seen = new Map();
    function visit(rules, baseURL) {
      for (const rule of Array.from(rules || [])) {
        if (rule.type === 5) {
          const f = state.cssFaces.get(rule) || cssConnectedFace(rule, baseURL);
          if (f) {
            seen.set(rule, f);
            faceState.get(f).sets.add(document._fontFaceSetWrapper);
          }
        } else if (rule.cssRules && rule.type !== 4) {
          visit(rule.cssRules, baseURL);
        }
      }
    }
    for (const sheet of document.styleSheets._list) {
      let baseURL = documentBaseURL(document);
      if (sheet.href) {
        const parsed = whatwgURL.parseURL(sheet.href, { baseURL });
        baseURL = parsed || baseURL;
      }
      try {
        visit(sheet.cssRules, baseURL);
      } catch {
        // A sheet whose rules cannot be read contributes none.
      }
    }
    state.cssFaces = seen;
    return Array.from(seen.values());
  }

  function entriesOf(target) {
    const state = set(target);
    return [...cssFacesOf(state), ...state.faces];
  }

  // https://drafts.csswg.org/css-font-loading/#find-the-matching-font-faces
  function matchingFaces(target, font, text) {
    const parsed = parseFontShorthand(font);
    if (parsed === null) {
      return null;
    }
    const codepoints = Array.from(String(text), c => c.codePointAt(0));
    const all = entriesOf(target);
    const matched = [];
    for (const family of parsed.families) {
      const lower = family.toLowerCase();
      const candidates = all.filter(f => faceState.get(f).family.toLowerCase() === lower);
      const styled = candidates.filter(f => /^(?:italic|oblique)/i.test(faceState.get(f).style) === parsed.italic);
      for (const f of styled.length ? styled : candidates) {
        const ranges = parseUnicodeRange(faceState.get(f).unicodeRange) || [[0, 0x10FFFF]];
        if (codepoints.some(cp => ranges.some(([a, b]) => cp >= a && cp <= b)) && !matched.includes(f)) {
          matched.push(f);
        }
      }
    }
    return matched;
  }

  for (const [name, value] of Object.entries({ FontFace, FontFaceSet, FontFaceSetLoadEvent })) {
    Object.defineProperty(window, name, { configurable: true, writable: true, value });
  }

  // https://drafts.csswg.org/css-font-loading/#font-face-source
  Object.defineProperty(window.Document.prototype, "fonts", {
    configurable: true,
    enumerable: true,
    get() {
      const document = idlUtils.implForWrapper(this);
      if (!document || document.nodeType !== 9) {
        throw new TypeError("Illegal invocation");
      }
      if (!document._fontFaceSetWrapper) {
        const fonts = new FontFaceSet();
        const state = set(fonts);
        state.document = document;
        document._fontFaceSetWrapper = fonts;
        document._fontsEnvironmentSettled = () => environmentSettled(fonts);
        if (pendingOnEnvironment(state)) {
          state.readyFulfilled = false;
          state.stuck = true;
          state.status = "loading";
          state.ready = new Promise(resolve => {
            state.resolveReady = resolve;
          });
        }
      }
      return document._fontFaceSetWrapper;
    }
  });
};

module.exports.parseFontShorthand = parseFontShorthand;
module.exports.parseSourceList = parseSourceList;
