"use strict";

const SVGElementImpl = require("./SVGElement-impl").implementation;
const { scriptElementImpl } = require("./HTMLScriptElement-impl");
const { XLINK_NS } = require("../helpers/namespaces");

// Its source is its href attribute, or the XLink one where there is none.
// https://svgwg.org/svg2-draft/interact.html#ScriptElement
class SVGScriptElementImpl extends scriptElementImpl(SVGElementImpl) {
  _sourceAttribute() {
    const href = this.getAttributeNS(null, "href");
    return href !== null ? href : this.getAttributeNS(XLINK_NS, "href");
  }

  _isSourceAttribute(name) {
    return name === "href" || name === "xlink:href";
  }
}

module.exports = {
  implementation: SVGScriptElementImpl
};
