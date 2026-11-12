"use strict";
const { mixin } = require("../../utils");
const ElementImpl = require("./Element-impl").implementation;
const DOMException = require("../generated/DOMException");
const MouseEvent = require("../generated/MouseEvent");
const ElementInternals = require("../generated/ElementInternals");
const ElementCSSInlineStyleImpl = require("./ElementCSSInlineStyle-impl").implementation;
const GlobalEventHandlersImpl = require("./GlobalEventHandlers-impl").implementation;
const HTMLOrSVGElementImpl = require("./HTMLOrSVGElement-impl").implementation;
const { firstChildWithLocalName } = require("../helpers/traversal");
const { isDisabled, formOwner } = require("../helpers/form-controls");
const { borderBoxOf } = require("../helpers/layout-geometry");
const { fireAnEvent } = require("../helpers/events");
const { asciiLowercase } = require("../helpers/strings");
const { lookupCEDefinition } = require("../helpers/custom-elements");
const { getInnerText, setInnerText } = require("../helpers/inner-text");
const {
  popoverStateOfValue,
  isShowing,
  checkPopoverValidity,
  showPopover,
  hidePopover,
  hidePopoverOnRemoval
} = require("../helpers/popover");

// https://html.spec.whatwg.org/multipage/interaction.html#autocapitalize-and-autocorrect-inheriting-elements
const autocapitalizeInheritingElements = new Set(["button", "fieldset", "input", "output", "select", "textarea"]);

const autocapitalizeStates = new Map([
  ["off", "none"],
  ["none", "none"],
  ["on", "sentences"],
  ["sentences", "sentences"],
  ["words", "words"],
  ["characters", "characters"]
]);

// https://html.spec.whatwg.org/multipage/interaction.html#own-autocapitalization-hint
function ownAutocapitalizationHint(element) {
  const value = element.getAttributeNS(null, "autocapitalize");
  if (value !== null) {
    // The invalid value default is the sentences state.
    return autocapitalizeStates.get(asciiLowercase(value)) ?? "sentences";
  }
  if (autocapitalizeInheritingElements.has(element._localName)) {
    const form = formOwner(element);
    if (form !== null) {
      return ownAutocapitalizationHint(form);
    }
  }
  return "default";
}

class HTMLElementImpl extends ElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);
    this._initHTMLOrSVGElement();
    this._initElementCSSInlineStyle();
    this._initGlobalEvents();

    this._clickInProgress = false;

    // <summary> uses HTMLElement and has activation behavior
    this._hasActivationBehavior = this._localName === "summary";

    // https://html.spec.whatwg.org/#attached-internals
    this._attachedInternals = null;

    // https://html.spec.whatwg.org/multipage/popover.html#the-popover-attribute
    this._popoverVisibilityState = "hidden";
    this._popoverInvoker = null;
    this._popoverShowingOrHiding = false;
    this._popoverToggleTaskTracker = null;
    this._popoverPreviouslyFocusedElement = null;
    this._openedInPopoverMode = null;
  }

  // https://html.spec.whatwg.org/multipage/popover.html#dom-showpopover
  showPopover(options) {
    showPopover(this, true, options.source ?? null);
  }

  // https://html.spec.whatwg.org/multipage/popover.html#dom-hidepopover
  hidePopover() {
    hidePopover(this, true, true, true, null);
  }

  // https://html.spec.whatwg.org/multipage/popover.html#dom-togglepopover
  // The IDL leaves out the union's `= {}` default, which webidl2js cannot generate: an absent options
  // arrives as undefined and is read as the empty dictionary.
  togglePopover(options = {}) {
    let force = null;
    let source = null;
    if (typeof options === "boolean") {
      force = options;
    } else {
      if (options.force !== undefined) {
        force = options.force;
      }
      source = options.source ?? null;
    }

    if (isShowing(this) && (force === null || force === false)) {
      hidePopover(this, true, true, true, null);
    } else if (force === null || force === true) {
      showPopover(this, true, source);
    } else {
      checkPopoverValidity(this, false, true, null);
    }
    return isShowing(this);
  }

  _detach() {
    super._detach();

    hidePopoverOnRemoval(this);
  }

  _activationBehavior() {
    const parent = this.parentNode;
    if (parent && parent._localName === "details" &&
        this === firstChildWithLocalName(parent, "summary")) {
      if (parent.hasAttributeNS(null, "open")) {
        parent.removeAttributeNS(null, "open");
      } else {
        parent.setAttributeNS(null, "open", "");
      }
    }
  }

  // https://html.spec.whatwg.org/multipage/dom.html#the-translate-attribute
  get translate() {
    const translateAttr = this.getAttributeNS(null, "translate");
    const translateAttrString = asciiLowercase(translateAttr || "");

    if (translateAttrString === "yes" || (translateAttr && translateAttrString === "")) {
      return true;
    } else if (translateAttrString === "no") {
      return false;
    }

    if (this === this.ownerDocument.documentElement) {
      return true;
    }

    return this.parentElement && this.parentElement.translate;
  }
  set translate(value) {
    if (value === true) {
      this.setAttributeNS(null, "translate", "yes");
    } else {
      this.setAttributeNS(null, "translate", "no");
    }
  }

  // https://html.spec.whatwg.org/multipage/interaction.html#dom-spellcheck
  // The default state inherits; at the root it is the user agent's default, which is to check.
  get spellcheck() {
    for (let element = this; element !== null; element = element.parentElement) {
      const value = element.getAttributeNS(null, "spellcheck");
      if (value === null) {
        continue;
      }
      const keyword = asciiLowercase(value);
      if (keyword === "true" || keyword === "") {
        return true;
      }
      if (keyword === "false") {
        return false;
      }
    }
    return true;
  }
  set spellcheck(value) {
    this.setAttributeNS(null, "spellcheck", value ? "true" : "false");
  }

  // https://html.spec.whatwg.org/multipage/interaction.html#dom-writingsuggestions
  get writingSuggestions() {
    for (let element = this; element !== null; element = element.parentElement) {
      const value = element.getAttributeNS(null, "writingsuggestions");
      if (value !== null) {
        const keyword = asciiLowercase(value);
        if (keyword === "false") {
          return "false";
        }
        if (keyword === "true" || keyword === "") {
          return "true";
        }
      }
    }
    return "true";
  }
  set writingSuggestions(value) {
    this.setAttributeNS(null, "writingsuggestions", value);
  }

  // https://html.spec.whatwg.org/multipage/interaction.html#dom-autocapitalize
  // Only the reflection: no text entry capitalizes on its account.
  get autocapitalize() {
    const state = ownAutocapitalizationHint(this);
    return state === "default" ? "" : state;
  }
  set autocapitalize(value) {
    this.setAttributeNS(null, "autocapitalize", value);
  }

  // https://html.spec.whatwg.org/multipage/dom.html#dom-innertext
  get innerText() {
    return getInnerText(this);
  }
  set innerText(value) {
    setInnerText(this, value);
  }

  click() {
    // https://html.spec.whatwg.org/multipage/interaction.html#dom-click
    // https://html.spec.whatwg.org/multipage/webappapis.html#fire-a-synthetic-mouse-event

    if (isDisabled(this)) {
      return;
    }

    if (this._clickInProgress) {
      return;
    }

    this._clickInProgress = true;

    // https://github.com/whatwg/html/issues/4451
    // https://github.com/whatwg/html/issues/4452
    fireAnEvent("click", this, MouseEvent, {
      bubbles: true,
      cancelable: true,
      composed: true,
      isTrusted: false,
      view: this.ownerDocument.defaultView
    });

    this._clickInProgress = false;
  }

  get draggable() {
    const attributeValue = asciiLowercase(this.getAttributeNS(null, "draggable") || "");

    if (attributeValue === "true") {
      return true;
    } else if (attributeValue === "false") {
      return false;
    }

    return this._localName === "img" || (this._localName === "a" && this.hasAttributeNS(null, "href"));
  }
  set draggable(value) {
    this.setAttributeNS(null, "draggable", String(value));
  }

  get dir() {
    let dirValue = this.getAttributeNS(null, "dir");
    if (dirValue !== null) {
      dirValue = dirValue.toLowerCase();

      if (["ltr", "rtl", "auto"].includes(dirValue)) {
        return dirValue;
      }
    }
    return "";
  }
  set dir(value) {
    this.setAttributeNS(null, "dir", value);
  }

  // https://html.spec.whatwg.org/#dom-attachinternals
  attachInternals() {
    if (this._isValue !== null) {
      throw DOMException.create(this._globalObject, [
        "Unable to attach ElementInternals to a customized built-in element.",
        "NotSupportedError"
      ]);
    }

    const definition = lookupCEDefinition(this._ownerDocument, this._namespaceURI, this._localName, null);

    if (definition === null) {
      throw DOMException.create(this._globalObject, [
        "Unable to attach ElementInternals to non-custom elements.",
        "NotSupportedError"
      ]);
    }

    if (definition.disableInternals === true) {
      throw DOMException.create(this._globalObject, [
        "ElementInternals is disabled by disabledFeature static field.",
        "NotSupportedError"
      ]);
    }

    if (this._attachedInternals !== null) {
      throw DOMException.create(this._globalObject, [
        "ElementInternals for the specified element was already attached.",
        "NotSupportedError"
      ]);
    }

    if (this._ceState !== "precustomized" && this._ceState !== "custom") {
      throw DOMException.create(this._globalObject, [
        "The attachInternals() function cannot be called prior to the execution of the custom element constructor.",
        "NotSupportedError"
      ]);
    }

    this._attachedInternals = ElementInternals.createImpl(this._globalObject, [], { targetElement: this });

    return this._attachedInternals;
  }

  // Keep in sync with SVGElement. https://github.com/jsdom/jsdom/issues/2599
  _attrModified(name, value, oldValue) {
    if (name === "style" && value !== oldValue && !this._settingCssText) {
      this._settingCssText = true;
      this._style.cssText = value;
      this._settingCssText = false;
    } else if (name.startsWith("on")) {
      this._globalEventChanged(name.substring(2));
    }
    this._attrModifiedHTMLOrSVGElement(name);

    // https://html.spec.whatwg.org/multipage/popover.html#the-popover-attribute: the attribute change steps.
    if (name === "popover" && isShowing(this) &&
        popoverStateOfValue(value) !== popoverStateOfValue(oldValue)) {
      hidePopover(this, true, true, false, null);
    }

    super._attrModified(name, value, oldValue);
  }

  // offsetTop and offsetLeft are measured from the offsetParent's border box,
  // so they need the nearest positioned ancestor — which needs each ancestor's
  // resolved `position`, a cascade read per step. The border box alone does not
  // answer them, and they stay zero rather than report a number measured from
  // somewhere else. getBoundingClientRect is the positioned read that works.
  get offsetParent() {
    return null;
  }

  get offsetTop() {
    return 0;
  }

  get offsetLeft() {
    return 0;
  }

  // The border box's own size, which needs no ancestor to interpret. Rounded:
  // these are long attributes, and a fractional box truncates towards zero
  // through the IDL layer rather than rounding.
  get offsetWidth() {
    const box = borderBoxOf(this);

    return box === null ? 0 : Math.round(box.width);
  }

  get offsetHeight() {
    const box = borderBoxOf(this);

    return box === null ? 0 : Math.round(box.height);
  }
}

mixin(HTMLElementImpl.prototype, ElementCSSInlineStyleImpl.prototype);
mixin(HTMLElementImpl.prototype, GlobalEventHandlersImpl.prototype);
mixin(HTMLElementImpl.prototype, HTMLOrSVGElementImpl.prototype);

module.exports = {
  implementation: HTMLElementImpl
};
