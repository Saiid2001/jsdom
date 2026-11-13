"use strict";
const whatwgURL = require("whatwg-url");
const idlUtils = require("../generated/utils");
const Blob = require("../generated/Blob");

// https://w3c.github.io/FileAPI/#BlobURLStore
//
// One store for every document in this process, as a user agent has one. An
// entry holds the Blob itself, so a URL keeps its bytes alive until it is
// revoked or the document that made it goes. A blob URL is answered from here
// and never requested: its bytes are already in the document.

const store = new Map();

function randomUUID() {
  const { crypto } = globalThis;
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; ++i) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function originOf(globalObject) {
  const document = globalObject._document;
  const origin = document ? idlUtils.implForWrapper(document)._origin : undefined;
  return typeof origin === "string" ? origin : "null";
}

// The URL an entry is stored under: the URL without its fragment.
function keyOf(url) {
  const parsed = whatwgURL.parseURL(String(url));
  if (!parsed || parsed.scheme !== "blob") {
    return null;
  }
  return whatwgURL.serializeURL(parsed, true);
}

// https://w3c.github.io/FileAPI/#dfn-createObjectURL
exports.createObjectURL = (globalObject, blobImpl) => {
  const url = `blob:${originOf(globalObject)}/${randomUUID()}`;
  store.set(url, { blob: blobImpl, globalObject, origin: originOf(globalObject) });
  return url;
};

// https://w3c.github.io/FileAPI/#dfn-revokeObjectURL
exports.revokeObjectURL = (globalObject, url) => {
  const key = keyOf(url);
  const entry = key === null ? undefined : store.get(key);

  if (entry && entry.origin === originOf(globalObject)) {
    store.delete(key);
  }
};

// The bytes and type a blob URL names, or null for one that names nothing.
exports.resolveBlobURL = url => {
  const key = keyOf(url);
  const entry = key === null ? undefined : store.get(key);

  if (!entry) {
    return null;
  }

  return { buffer: entry.blob._buffer, type: entry.blob.type };
};

// https://w3c.github.io/FileAPI/#lifeTime: a document's URLs are revoked when
// it is unloaded.
exports.revokeAllFor = globalObject => {
  for (const [url, entry] of store) {
    if (entry.globalObject === globalObject) {
      store.delete(url);
    }
  }
};

// Installs the static operations on a window's URL interface object.
exports.install = globalObject => {
  const { URL } = globalObject;
  if (typeof URL !== "function") {
    return;
  }

  const operations = {
    createObjectURL(obj) {
      if (arguments.length < 1) {
        throw new TypeError(
          "Failed to execute 'createObjectURL' on 'URL': 1 argument required, but only 0 present."
        );
      }
      if (!Blob.is(obj)) {
        throw new TypeError("Failed to execute 'createObjectURL' on 'URL': Overload resolution failed.");
      }
      return exports.createObjectURL(globalObject, idlUtils.implForWrapper(obj));
    },
    revokeObjectURL(url) {
      if (arguments.length < 1) {
        throw new TypeError(
          "Failed to execute 'revokeObjectURL' on 'URL': 1 argument required, but only 0 present."
        );
      }
      exports.revokeObjectURL(globalObject, `${url}`);
    }
  };

  for (const name of Object.keys(operations)) {
    Object.defineProperty(URL, name, {
      value: operations[name],
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
};
