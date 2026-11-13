"use strict";

const HTMLElementImpl = require("./HTMLElement-impl").implementation;

const Document = require("../generated/Document");
const DocumentFragment = require("../generated/DocumentFragment");

const { cloningSteps, domSymbolTree } = require("../helpers/internal-constants");
const { clone } = require("../node");

class HTMLTemplateElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    const doc = this._appropriateTemplateContentsOwnerDocument(this._ownerDocument);
    this._templateContents = DocumentFragment.createImpl(this._globalObject, [], {
      ownerDocument: doc,
      host: this
    });
  }

  // https://html.spec.whatwg.org/multipage/scripting.html#dom-template-shadowrootmode
  // Enumerated, limited to known values, with no missing or invalid value default.
  get shadowRootMode() {
    const value = (this.getAttributeNS(null, "shadowrootmode") ?? "").toLowerCase();
    return value === "open" || value === "closed" ? value : "";
  }

  set shadowRootMode(value) {
    this.setAttributeNS(null, "shadowrootmode", value);
  }

  // https://html.spec.whatwg.org/multipage/scripting.html#dom-template-shadowrootslotassignment
  // Enumerated, limited to known values, "named" when missing or invalid.
  get shadowRootSlotAssignment() {
    const value = (this.getAttributeNS(null, "shadowrootslotassignment") ?? "").toLowerCase();
    return value === "manual" ? "manual" : "named";
  }

  set shadowRootSlotAssignment(value) {
    this.setAttributeNS(null, "shadowrootslotassignment", value);
  }

  // https://html.spec.whatwg.org/multipage/scripting.html#appropriate-template-contents-owner-document
  _appropriateTemplateContentsOwnerDocument(doc) {
    if (!doc._isInertTemplateDocument) {
      if (doc._associatedInertTemplateDocument === undefined) {
        const newDoc = Document.createImpl(this._globalObject, [], {
          options: {
            parsingMode: doc._parsingMode,
            encoding: doc._encoding
          }
        });
        newDoc._isInertTemplateDocument = true;

        doc._associatedInertTemplateDocument = newDoc;
      }

      doc = doc._associatedInertTemplateDocument;
    }

    return doc;
  }

  // https://html.spec.whatwg.org/multipage/scripting.html#template-adopting-steps
  _adoptingSteps() {
    const doc = this._appropriateTemplateContentsOwnerDocument(this._ownerDocument);
    doc._adoptNode(this._templateContents);
  }

  get content() {
    return this._templateContents;
  }

  [cloningSteps](copy, node, document, cloneChildren) {
    if (!cloneChildren) {
      return;
    }

    for (const child of domSymbolTree.childrenIterator(node._templateContents)) {
      const childCopy = clone(child, copy._templateContents._ownerDocument, true);
      copy._templateContents.appendChild(childCopy);
    }
  }
}

module.exports = {
  implementation: HTMLTemplateElementImpl
};
