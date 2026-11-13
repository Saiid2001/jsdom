"use strict";

const idlUtils = require("../generated/utils.js");
const { treeOrderSorter } = require("../../utils");

exports.implementation = class StyleSheetList {
  constructor() {
    this._list = [];
  }

  get length() {
    return this._list.length;
  }

  item(index) {
    const result = this._list[index];
    return result !== undefined ? result : null;
  }

  get [idlUtils.supportedPropertyIndices]() {
    return this._list.keys();
  }

  // In the tree order of the nodes the sheets belong to, which is their order
  // in the cascade: a linked sheet arrives once fetched, after the <style>s
  // parsed meanwhile, and must not go after them. A sheet a sheet imports goes
  // just before the sheet importing it.
  // https://drafts.csswg.org/cssom/#documentorshadowroot-document-or-shadow-root-css-style-sheets
  _add(sheet, node = null, { imported = false } = {}) {
    const { _list } = this;
    if (_list.includes(sheet)) {
      return;
    }

    Object.defineProperty(sheet, "_treeNode", { value: node, configurable: true, writable: true });

    const index = node ?
      _list.findIndex(other => other._treeNode &&
        (treeOrderSorter(node, other._treeNode) < 0 || (imported && other._treeNode === node))) :
      -1;

    if (index === -1) {
      _list.push(sheet);
    } else {
      _list.splice(index, 0, sheet);
    }
  }

  _remove(sheet) {
    const { _list } = this;

    const index = _list.indexOf(sheet);
    if (index >= 0) {
      _list.splice(index, 1);
    }
  }
};
