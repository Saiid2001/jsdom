"use strict";
const cssom = require("rrweb-cssom");
const { CSSStyleDeclaration } = require("cssstyle");
const defaultStyleSheet = require("../../browser/default-stylesheet");
const { getSpecifiedColor, getComputedOrUsedColor } = require("./colors");
const { matchesDontThrow } = require("./selectors");

const { forEach, indexOf } = Array.prototype;

let parsedDefaultStyleSheet;

// Properties for which getResolvedValue is implemented. This is less than
// every supported property.
// https://drafts.csswg.org/indexes/#properties
exports.propertiesWithResolvedValueImplemented = {
  "__proto__": null,

  // https://drafts.csswg.org/css2/visufx.html#visibility
  "visibility": {
    inherited: true,
    initial: "visible",
    computedValue: "as-specified"
  },
  // https://svgwg.org/svg2-draft/interact.html#PointerEventsProperty
  "pointer-events": {
    inherited: true,
    initial: "auto",
    computedValue: "as-specified"
  },
  // https://drafts.csswg.org/css-backgrounds-3/#propdef-background-color
  "background-color": {
    inherited: false,
    initial: "transparent",
    computedValue: "computed-color"
  },
  // https://drafts.csswg.org/css-logical-1/#propdef-border-block-end-color
  "border-block-start-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  "border-block-end-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  "border-inline-start-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  "border-inline-end-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  // https://drafts.csswg.org/css-backgrounds-3/#propdef-border-bottom-color
  "border-top-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  "border-right-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  "border-bottom-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  "border-left-color": {
    inherited: false,
    initial: "currentcolor",
    computedValue: "computed-color"
  },
  // https://drafts.csswg.org/css-ui-4/#propdef-caret-color
  "caret-color": {
    inherited: true,
    initial: "auto",
    computedValue: "computed-color"
  },
  // https://drafts.csswg.org/css-color-4/#propdef-color
  "color": {
    inherited: true,
    initial: "CanvasText",
    computedValue: "computed-color"
  },
  // https://drafts.csswg.org/css-ui-4/#propdef-outline-color
  "outline-color": {
    inherited: false,
    initial: "invert",
    computedValue: "computed-color"
  }
};

function forEachMatchingSheetRuleOfElement(elementImpl, handleRule) {
  function handleSheet(sheet) {
    forEach.call(sheet.cssRules, rule => {
      if (rule.media) {
        if (indexOf.call(rule.media, "screen") !== -1) {
          forEach.call(rule.cssRules, innerRule => {
            if (matches(innerRule, elementImpl)) {
              handleRule(innerRule);
            }
          });
        }
      } else if (matches(rule, elementImpl)) {
        handleRule(rule);
      }
    });
  }

  if (!parsedDefaultStyleSheet) {
    parsedDefaultStyleSheet = cssom.parse(defaultStyleSheet);
  }

  handleSheet(parsedDefaultStyleSheet);
  forEach.call(elementImpl._ownerDocument.styleSheets._list, handleSheet);
}

exports.invalidateStyleCache = elementImpl => {
  if (elementImpl._attached) {
    elementImpl._ownerDocument._styleCache = null;
  }
};

exports.getDeclarationForElement = elementImpl => {
  let styleCache = elementImpl._ownerDocument._styleCache;
  if (!styleCache) {
    styleCache = elementImpl._ownerDocument._styleCache = new WeakMap();
  }

  const cachedDeclaration = styleCache.get(elementImpl);
  if (cachedDeclaration) {
    return cachedDeclaration;
  }

  const declaration = new CSSStyleDeclaration();

  function handleProperty(style, property) {
    const value = style.getPropertyValue(property);
    // https://drafts.csswg.org/css-cascade-4/#valdef-all-unset
    if (value === "unset") {
      declaration.removeProperty(property);
    } else {
      declaration.setProperty(
        property,
        value,
        style.getPropertyPriority(property)
      );
    }
  }

  forEachMatchingSheetRuleOfElement(elementImpl, rule => {
    forEach.call(rule.style, property => {
      handleProperty(rule.style, property);
    });
  });

  forEach.call(elementImpl.style, property => {
    handleProperty(elementImpl.style, property);
  });

  styleCache.set(elementImpl, declaration);

  return declaration;
};

// Style resolution runs every rule of every sheet against every element, so
// selector matching dominates getComputedStyle on real pages. Browsers avoid it
// by indexing rules on the rightmost simple selector and rejecting the rest
// without matching. Same idea here, as a pre-filter: rule order, and therefore
// the cascade, is untouched — only matches() calls that cannot succeed are
// skipped.
// Keyed by rule rather than by selector text: this is looked up once per rule
// per element, and hashing the selector string was costing more than the
// matches() calls it saves.
const keysByRule = new WeakMap();

// The trailing tag/#id/.class of each comma separated branch, which an element
// must carry for that branch to have any chance of matching.
function selectorRejectionKeys(selectorText) {
  let cached = [];

  for (const branch of selectorText.split(",")) {
    // The rightmost compound selector decides whether the element itself can
    // match; everything before it constrains ancestors and siblings.
    const compound = branch.trim().split(/[\s>+~]+/).pop() || "";

    // Anything exotic (pseudo classes, attribute selectors, "*") is passed
    // through to the real matcher rather than guessed at.
    if (!compound || !/^[a-zA-Z0-9_\-#.]+$/.test(compound)) {
      cached = null;
      break;
    }

    const id = compound.match(/#([\w-]+)/);
    const classes = compound.match(/\.([\w-]+)/g);
    const tag = compound.match(/^([a-zA-Z][\w-]*)/);

    cached.push({
      id: id ? id[1] : null,
      classes: classes ? classes.map(c => c.slice(1)) : null,
      tag: tag ? tag[1].toLowerCase() : null,
    });
  }

  return cached;
}

function rejectionKeysForRule(rule) {
  let branches = keysByRule.get(rule);

  if (branches === undefined) {
    // At-rules such as @font-face carry no selector; leave them to the matcher.
    branches = typeof rule.selectorText === "string"
      ? selectorRejectionKeys(rule.selectorText)
      : null;
    keysByRule.set(rule, branches);
  }

  return branches;
}

function canPossiblyMatch(rule, element) {
  const branches = rejectionKeysForRule(rule);

  // Unsupported selector shapes fall back to matching for real.
  if (branches === null) {
    return true;
  }

  for (const branch of branches) {
    if (branch.id && element.getAttributeNS(null, "id") !== branch.id) {
      continue;
    }
    if (branch.tag && element._localName !== branch.tag) {
      continue;
    }
    if (branch.classes) {
      const list = element.classList;
      if (branch.classes.some(name => !list.contains(name))) {
        continue;
      }
    }
    return true;
  }

  return false;
}

function matches(rule, element) {
  if (!canPossiblyMatch(rule, element)) {
    return false;
  }

  return matchesDontThrow(element, rule.selectorText);
}

// Naive implementation of https://drafts.csswg.org/css-cascade-4/#cascading
// based on the previous jsdom implementation of getComputedStyle.
// Does not implement https://drafts.csswg.org/css-cascade-4/#cascade-specificity,
// or rather specificity is only implemented by the order in which the matching
// rules appear. The last rule is the most specific while the first rule is
// the least specific.
function getCascadedPropertyValue(element, property) {
  return exports.getDeclarationForElement(element).getPropertyValue(property);
}

// https://drafts.csswg.org/css-cascade-4/#specified-value
function getSpecifiedValue(element, property) {
  const { initial, inherited, computedValue } = exports.propertiesWithResolvedValueImplemented[property];
  const cascade = getCascadedPropertyValue(element, property);

  if (cascade !== "") {
    if (computedValue === "computed-color") {
      return getSpecifiedColor(cascade);
    }

    return cascade;
  }

  // Defaulting
  if (inherited && element.parentElement !== null) {
    return getComputedValue(element.parentElement, property);
  }

  // root element without parent element or inherited property
  return initial;
}

// https://drafts.csswg.org/css-cascade-4/#computed-value
function getComputedValue(element, property) {
  const { computedValue, initial } = exports.propertiesWithResolvedValueImplemented[property];
  if (computedValue === "as-specified") {
    return getSpecifiedValue(element, property);
  } else if (computedValue === "computed-color") {
    const specifiedValue = getSpecifiedValue(element, property);

    // https://drafts.csswg.org/css-color-4/#resolving-other-colors
    if (specifiedValue === "currentcolor") {
      if (property === "color") {
        if (element.parentElement !== null) {
          return getComputedValue(element.parentElement, "color");
        }
        return initial;
      }

      return getComputedValue(element, "color");
    }

    return getComputedOrUsedColor(specifiedValue);
  }

  throw new TypeError(`Internal error: unrecognized computed value instruction '${computedValue}'`);
}

// https://drafts.csswg.org/cssom/#resolved-value
// Only implements the properties that are defined in propertiesWithResolvedValueImplemented.
exports.getResolvedValue = (element, property) => {
  // We can always use the computed value with the current set of propertiesWithResolvedValueImplemented:
  // * Color properties end up with the used value, but we don't implement any actual differences between used and
  //   computed that https://drafts.csswg.org/css-cascade-5/#used-value gestures at.
  // * The other properties fall back to the "any other property: The resolved value is the computed value." case.
  return getComputedValue(element, property);
};

exports.SHADOW_DOM_PSEUDO_REGEXP = /^::(?:part|slotted)\(/i;
