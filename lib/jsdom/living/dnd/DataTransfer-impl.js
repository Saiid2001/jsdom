"use strict";

const FileList = require("../generated/FileList");
const DataTransferItemList = require("../generated/DataTransferItemList");
const { asciiLowercase } = require("../helpers/strings");

const DROP_EFFECTS = new Set(["none", "copy", "link", "move"]);
const EFFECTS_ALLOWED = new Set(
  ["none", "copy", "copyLink", "copyMove", "link", "linkMove", "move", "all", "uninitialized"]
);

// The legacy format names getData(), setData() and clearData() accept for the two common types.
function normalizeFormat(format) {
  const lower = asciiLowercase(format);
  if (lower === "text") {
    return { type: "text/plain", convertToURL: false };
  }
  if (lower === "url") {
    return { type: "text/uri-list", convertToURL: true };
  }
  return { type: lower, convertToURL: false };
}

// https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransfer-getdata, step 8: the first URL of a
// text/uri-list, whose lines starting with "#" are comments.
function firstURL(uriList) {
  for (const line of uriList.split(/\r\n|\r|\n/u)) {
    if (line !== "" && !line.startsWith("#")) {
      return line;
    }
  }
  return "";
}

// https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface
//
// A DataTransfer made by its constructor owns a drag data store in read/write mode, which is the only kind there is:
// no drag-and-drop operation is ever started for the document, so no store is ever put in protected or read-only
// mode. The store is the list of { kind, type, data } items shared with `items`.
class DataTransferImpl {
  constructor(globalObject) {
    this._globalObject = globalObject;
    this._store = { mode: "read/write", items: [] };
    this._dropEffect = "none";
    this._effectAllowed = "none";
    this._types = Object.freeze([]);
    this._files = FileList.createImpl(globalObject);
    this._items = DataTransferItemList.createImpl(globalObject, [], { dataTransfer: this });
  }

  get dropEffect() {
    return this._dropEffect;
  }

  set dropEffect(value) {
    if (DROP_EFFECTS.has(value)) {
      this._dropEffect = value;
    }
  }

  get effectAllowed() {
    return this._effectAllowed;
  }

  set effectAllowed(value) {
    if (this._store.mode === "read/write" && EFFECTS_ALLOWED.has(value)) {
      this._effectAllowed = value;
    }
  }

  get items() {
    return this._items;
  }

  // There is no drag feedback to set an image on.
  setDragImage() {}

  get types() {
    return this._types;
  }

  get files() {
    return this._files;
  }

  getData(format) {
    const { type, convertToURL } = normalizeFormat(format);
    const item = this._store.items.find(i => i.kind === "string" && i.type === type);
    if (!item) {
      return "";
    }
    return convertToURL ? firstURL(item.data) : item.data;
  }

  setData(format, data) {
    if (this._store.mode !== "read/write") {
      return;
    }
    const { type } = normalizeFormat(format);
    this._store.items = this._store.items.filter(i => !(i.kind === "string" && i.type === type));
    this._store.items.push({ kind: "string", type, data });
    this._storeChanged();
  }

  clearData(format) {
    if (this._store.mode !== "read/write") {
      return;
    }
    if (format === undefined) {
      this._store.items = this._store.items.filter(i => i.kind !== "string");
    } else {
      const { type } = normalizeFormat(format);
      this._store.items = this._store.items.filter(i => !(i.kind === "string" && i.type === type));
    }
    this._storeChanged();
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#concept-datatransfer-types
  // `types` is replaced, not mutated, so a page holding the old array keeps what it read; `files` is the same
  // FileList throughout, refilled from the store.
  _storeChanged() {
    const types = [];
    let hasFiles = false;
    for (const item of this._store.items) {
      if (item.kind === "string") {
        types.push(item.type);
      } else {
        hasFiles = true;
      }
    }
    if (hasFiles) {
      types.push("Files");
    }
    this._types = Object.freeze(types);

    this._files.length = 0;
    for (const item of this._store.items) {
      if (item.kind === "file") {
        this._files.push(item.data);
      }
    }
  }
}

module.exports = {
  implementation: DataTransferImpl
};
