"use strict";
const idlUtils = require("../generated/utils");
const NODE_TYPE = require("../node-type");
const { nodeRoot } = require("../helpers/node");
const { retarget } = require("../helpers/shadow-dom");
const { elementsAtPoint } = require("../helpers/hit-testing");
const { areaAtPoint } = require("../helpers/image-maps");

class DocumentOrShadowRootImpl {
  get activeElement() {
    let candidate = this._ownerDocument._lastFocusedElement || this._ownerDocument.body;
    if (!candidate) {
      return null;
    }
    candidate = retarget(candidate, this);
    if (nodeRoot(candidate) !== this) {
      return null;
    }
    if (candidate.nodeType !== NODE_TYPE.DOCUMENT_NODE) {
      return candidate;
    }
    if (candidate.body !== null) {
      return candidate.body;
    }
    return candidate.documentElement;
  }

  // https://drafts.csswg.org/cssom-view/#dom-document-elementfrompoint
  elementFromPoint(x, y) {
    const hits = this._elementsAtViewportPoint(x, y);
    if (hits === null) {
      return null;
    }

    if (hits.length === 0) {
      return this._documentForHitTesting().documentElement;
    }

    return retarget(hits[0], this);
  }

  // https://drafts.csswg.org/cssom-view/#dom-document-elementsfrompoint
  elementsFromPoint(x, y) {
    const hits = this._elementsAtViewportPoint(x, y);
    if (hits === null) {
      return [];
    }

    // Retargeting folds a shadow tree's elements into their host, once.
    const sequence = [];
    for (const hit of hits) {
      const element = retarget(hit, this);
      if (!sequence.includes(element)) {
        sequence.push(element);
      }
    }

    const root = this._documentForHitTesting().documentElement;
    if (root && sequence[sequence.length - 1] !== root) {
      const index = sequence.indexOf(root);
      if (index !== -1) {
        sequence.splice(index, 1);
      }
      sequence.push(root);
    }

    // A sequence is returned as it is, so its members are converted here.
    return sequence.map(idlUtils.wrapperForImpl);
  }

  _documentForHitTesting() {
    return this.nodeType === NODE_TYPE.DOCUMENT_NODE ? this : this._ownerDocument;
  }

  // The hit test's answer for a point, or null for a point outside the viewport, for a document with no viewport
  // and where nothing is painted to hit.
  _elementsAtViewportPoint(x, y) {
    const document = this._documentForHitTesting();
    const view = document._defaultView;
    if (!view) {
      return null;
    }

    if (x < 0 || y < 0 || x > view.innerWidth || y > view.innerHeight) {
      return null;
    }

    const hits = elementsAtPoint(document, x, y);
    if (hits === null) {
      return null;
    }

    // An image map's area has no box of its own: it is the hit target where its image is hit inside its shape, and
    // is listed above the image.
    return hits.flatMap(hit => {
      const area = areaAtPoint(hit, x, y);
      return area ? [area, hit] : [hit];
    });
  }
}

module.exports = {
  implementation: DocumentOrShadowRootImpl
};
