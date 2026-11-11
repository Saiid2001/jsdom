"use strict";

const conversions = require("webidl-conversions");
const { parseInteger } = require("../helpers/strings");
const { isSummaryForParentDetails } = require("../helpers/details");
const focusing = require("../helpers/focusing");
const { HTML_NS, SVG_NS } = require("../helpers/namespaces");
const DOMStringMap = require("../generated/DOMStringMap");

const tabIndexReflectAllowedHTMLElements = new Set([
  "a", "area", "button", "frame", "iframe",
  "input", "object", "select", "textarea"
]);

class HTMLOrSVGElementImpl {
  _initHTMLOrSVGElement() {
    this._tabIndex = 0;
    this._dataset = DOMStringMap.createImpl(this._globalObject, [], { element: this });

    // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cryptographicnonce
    this._cryptographicNonce = "";
  }

  // The nonce content attribute's change steps. Setting the IDL attribute sets only the internal slot, so a
  // nonce written by script is not readable back through getAttribute(). Nonce hiding is not implemented: no
  // Content-Security-Policy is enforced to hide it from.
  _attrModifiedHTMLOrSVGElement(name) {
    if (name === "nonce") {
      this._cryptographicNonce = this.getAttributeNS(null, "nonce") ?? "";
    }
  }

  get nonce() {
    return this._cryptographicNonce;
  }

  set nonce(value) {
    this._cryptographicNonce = value;
  }

  get dataset() {
    return this._dataset;
  }

  // https://html.spec.whatwg.org/multipage/interaction.html#dom-tabindex
  // The default, for a missing value or one that does not parse, depends on the element.
  get tabIndex() {
    const attributeValue = this.getAttributeNS(null, "tabindex");
    if (attributeValue !== null) {
      const value = parseInteger(attributeValue);
      if (value !== null && conversions.long(value) === value) {
        return value;
      }
    }
    if ((this.namespaceURI === HTML_NS && (tabIndexReflectAllowedHTMLElements.has(this._localName) ||
                                           (this._localName === "summary" && isSummaryForParentDetails(this)))) ||
        (this.namespaceURI === SVG_NS && this._localName === "a")) {
      return 0;
    }
    return -1;
  }

  set tabIndex(value) {
    this.setAttributeNS(null, "tabindex", String(value));
  }

  focus() {
    
    const ownerDocument = this._ownerDocument;
    const previous = ownerDocument._lastFocusedElement;

    if (previous === this) {
      return;
    }

    ownerDocument._lastFocusedElement = null;
    if (previous) {
      focusing.fireFocusEventWithTargetAdjustment("blur", previous, this);
      focusing.fireFocusEventWithTargetAdjustment("focusout", previous, this, { bubbles: true });
    } else {
      const frameElement = ownerDocument._defaultView._frameElement;
      if (frameElement) {
        const frameLastFocusedElement = frameElement.ownerDocument._lastFocusedElement;
        frameElement.ownerDocument._lastFocusedElement = null;
        focusing.fireFocusEventWithTargetAdjustment("blur", frameLastFocusedElement, null);
        focusing.fireFocusEventWithTargetAdjustment("focusout", frameLastFocusedElement, null, { bubbles: true });
        frameElement.ownerDocument._lastFocusedElement = frameElement;
      }
    }

    // blurring of previous elements must still occur even if the current element is not focusable
    if (!focusing.isFocusableAreaElement(this)) {
      return;
    }

    ownerDocument._lastFocusedElement = this;
    focusing.fireFocusEventWithTargetAdjustment("focus", this, previous);
    focusing.fireFocusEventWithTargetAdjustment("focusin", this, previous, { bubbles: true });
    ownerDocument.getSelection().collapse(this, 0);
  }

  blur() {
    if (this._ownerDocument._lastFocusedElement !== this || !focusing.isFocusableAreaElement(this)) {
      return;
    }

    this._ownerDocument._lastFocusedElement = null;
    focusing.fireFocusEventWithTargetAdjustment("blur", this, null);
    focusing.fireFocusEventWithTargetAdjustment("focusout", this, null, { bubbles: true });
    this._ownerDocument.getSelection().empty();
  }
}

exports.implementation = HTMLOrSVGElementImpl;
