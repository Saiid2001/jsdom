"use strict";
const cssom = require("rrweb-cssom");
const { CSSStyleDeclaration } = require("cssstyle");
const defaultStyleSheet = require("../../browser/default-stylesheet");
const { getSpecifiedColor, getComputedOrUsedColor } = require("./colors");
const { matchesDontThrow } = require("./selectors");
const { matchesMediaList, viewportForWindow } = require("./media-queries");

const { forEach } = Array.prototype;

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
  // https://drafts.csswg.org/css-text/#text-align-property
  //
  // Inheritance is implemented for the properties in this table and no others:
  // an inherited property left out of it reaches the element that declares it
  // and stops there, and every descendant reports an empty value.
  "text-align": {
    inherited: true,
    initial: "start",
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

// Whether a media list matches is a property of the viewport, not of the
// element, but the cascade asks once per rule per element. The answer is cached
// against the viewport it was computed for and recomputed when that changes.
const mediaMatchCache = new WeakMap();

function mediaApplies(mediaList, viewport) {
  const cached = mediaMatchCache.get(mediaList);

  if (cached !== undefined &&
    cached.width === viewport.width &&
    cached.height === viewport.height &&
    cached.pixelRatio === viewport.pixelRatio) {
    return cached.matches;
  }

  const matchesMedia = matchesMediaList(mediaList, viewport);

  mediaMatchCache.set(mediaList, {
    width: viewport.width,
    height: viewport.height,
    pixelRatio: viewport.pixelRatio,
    matches: matchesMedia
  });

  return matchesMedia;
}

// Rules indexed by the rightmost simple selector they end in.
//
// Style resolution asks, for every element, which rules apply to it. Testing
// every rule against every element is quadratic: a long article with 1,370
// rules and 14,000 elements is nineteen million selector tests, and it was the
// single largest cost of loading a page. Browsers avoid it by indexing rules on
// that rightmost selector and only testing the ones an element could match.
//
// The index is built once per document and reused until the style cache is
// invalidated. Rule order is preserved, because the cascade depends on it.
function buildRuleIndex(document, viewport) {
  const index = {
    byId: new Map(),
    byClass: new Map(),
    byTag: new Map(),
    // Rules whose selector this cannot index — "*", attribute selectors,
    // pseudo classes — which every element therefore has to test.
    universal: [],
    viewport
  };

  let order = 0;

  const addTo = (map, key, entry) => {
    const list = map.get(key);

    if (list) {
      // A rule listing the same key twice belongs in the bucket once.
      if (list[list.length - 1] !== entry) {
        list.push(entry);
      }
    } else {
      map.set(key, [entry]);
    }
  };

  const collect = rules => {
    forEach.call(rules, rule => {
      // A conditional group rule contributes its contents only when the
      // condition holds, and those contents can nest further groups. Whether it
      // holds depends on the viewport, which is why the index is rebuilt when
      // the viewport changes.
      if (rule.media) {
        if (mediaApplies(rule.media, viewport)) {
          collect(rule.cssRules);
        }
        return;
      }

      // @supports: this engine cannot test a declaration for support, and
      // treating the condition as met matches what a modern browser does for
      // the properties sites actually guard on.
      if (rule.cssRules && typeof rule.conditionText === "string") {
        collect(rule.cssRules);
        return;
      }

      // @font-face, @keyframes and friends carry no selector to match.
      if (typeof rule.selectorText !== "string") {
        return;
      }

      // Whether a rule reads a variable, and which custom properties it sets,
      // are properties of the rule itself. Working them out once, here, is what
      // lets a cache lookup skip walking the rule's declarations.
      let usesVariables = false;
      let customProperties = null;

      forEach.call(rule.style, property => {
        const value = rule.style.getPropertyValue(property);

        if (typeof value === "string" && value.indexOf("var(") !== -1) {
          usesVariables = true;
        }

        if (property.startsWith("--")) {
          customProperties = customProperties || [];
          customProperties.push([property, value]);
        }
      });

      const entry = { rule, order: order++, usesVariables, customProperties };
      const branches = rejectionKeysForRule(rule);

      if (branches === null) {
        index.universal.push(entry);
        return;
      }

      for (const branch of branches) {
        // An id is the most selective thing a branch can end in, then a class,
        // then a tag. A branch with none of them could match anything.
        if (branch.id) {
          addTo(index.byId, branch.id, entry);
        } else if (branch.classes && branch.classes.length > 0) {
          addTo(index.byClass, branch.classes[0], entry);
        } else if (branch.tag) {
          addTo(index.byTag, branch.tag, entry);
        } else {
          index.universal.push(entry);
          return;
        }
      }
    });
  };

  if (!parsedDefaultStyleSheet) {
    parsedDefaultStyleSheet = cssom.parse(defaultStyleSheet);
  }

  collect(parsedDefaultStyleSheet.cssRules);
  forEach.call(document.styleSheets._list, sheet => collect(sheet.cssRules));

  return index;
}

function ruleIndexFor(document, viewport) {
  const cached = document._ruleIndex;

  if (cached &&
    cached.viewport.width === viewport.width &&
    cached.viewport.height === viewport.height &&
    cached.viewport.pixelRatio === viewport.pixelRatio) {
    return cached;
  }

  document._ruleIndex = buildRuleIndex(document, viewport);

  return document._ruleIndex;
}

function forEachMatchingSheetRuleOfElement(elementImpl, handleRule) {
  const document = elementImpl._ownerDocument;
  const viewport = viewportForWindow(document._defaultView);
  const index = ruleIndexFor(document, viewport);

  // Only the rules that end in something this element carries can match, plus
  // the ones that could not be indexed.
  const candidates = [];
  const seen = new Set();

  const gather = list => {
    if (!list) {
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const entry = list[i];

      if (!seen.has(entry.order)) {
        seen.add(entry.order);
        candidates.push(entry);
      }
    }
  };

  gather(index.universal);

  const id = elementImpl.getAttributeNS(null, "id");

  if (id) {
    gather(index.byId.get(id));
  }

  gather(index.byTag.get(elementImpl._localName));

  // The token list is not indexable from here, so the attribute is read
  // directly.
  const className = elementImpl.getAttributeNS(null, "class");

  if (className) {
    const names = className.split(/\s+/);

    for (let i = 0; i < names.length; i++) {
      if (names[i]) {
        gather(index.byClass.get(names[i]));
      }
    }
  }

  // The cascade is decided by document order, which the buckets do not preserve
  // between them.
  candidates.sort((a, b) => a.order - b.order);

  for (let i = 0; i < candidates.length; i++) {
    const { rule } = candidates[i];

    if (matches(rule, elementImpl)) {
      handleRule(rule, candidates[i]);
    }
  }
}

exports.invalidateStyleCache = elementImpl => {
  if (elementImpl._attached) {
    elementImpl._ownerDocument._styleCache = null;
    elementImpl._ownerDocument._customPropertyCache = null;
    elementImpl._ownerDocument._ruleIndex = null;
    elementImpl._ownerDocument._declarationCache = null;
  }
};

// Custom properties and var() substitution.
//
// https://drafts.csswg.org/css-variables-1/
//
// A property whose value references a variable cannot be parsed as that
// property until the reference is replaced, and the parser rejects the whole
// declaration if it is handed one. Substitution therefore has to happen here,
// before the value reaches the property, or every "padding: var(--gap)" on the
// page is silently dropped.

/** How deep a chain of variables referring to variables may go. */
const SUBSTITUTION_LIMIT = 50;

/** Locates the outermost var() call, respecting nested parentheses. */
function findVarCall(text) {
  const start = text.indexOf("var(");

  if (start === -1) {
    return null;
  }

  let depth = 0;

  for (let i = start + 3; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    } else if (text[i] === ")") {
      depth--;

      if (depth === 0) {
        return { start, end: i, inner: text.slice(start + 4, i) };
      }
    }
  }

  return null;
}

/** Splits "--name, fallback" at the comma that separates the two. */
function splitReference(text) {
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") {
      depth++;
    } else if (text[i] === ")") {
      depth--;
    } else if (text[i] === "," && depth === 0) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }

  return [text, null];
}

/**
 * Replaces every var() in a value.
 * @returns the substituted value, or null when a reference cannot be resolved
 *   and has no fallback, which makes the declaration invalid at computed value
 *   time and so not a declaration at all.
 */
function substituteVariables(value, properties, resolving, depth) {
  if (typeof value !== "string" || value.indexOf("var(") === -1) {
    return value;
  }

  if (depth > SUBSTITUTION_LIMIT) {
    return null;
  }

  let out = value;

  for (let guard = 0; guard < SUBSTITUTION_LIMIT; guard++) {
    const call = findVarCall(out);

    if (!call) {
      return out;
    }

    const [nameText, fallbackText] = splitReference(call.inner);
    const name = nameText.trim();

    let replacement = null;

    // A variable that refers to itself, directly or through others, is not
    // resolvable; the reference falls back instead of looping.
    if (properties.has(name) && !resolving.has(name)) {
      resolving.add(name);
      replacement = substituteVariables(properties.get(name), properties, resolving, depth + 1);
      resolving.delete(name);
    }

    if (replacement === null && fallbackText !== null) {
      replacement = substituteVariables(fallbackText.trim(), properties, resolving, depth + 1);
    }

    if (replacement === null) {
      return null;
    }

    out = out.slice(0, call.start) + replacement + out.slice(call.end + 1);
  }

  return null;
}

// Each distinct set of custom properties gets an id, so a declaration that
// reads one can say which scope it was resolved in.
const scopeIds = new WeakMap();
let nextScopeId = 1;

/** The custom properties in scope at an element, its own over its parent's. */
function customPropertiesForElement(elementImpl, own) {
  let cache = elementImpl._ownerDocument._customPropertyCache;

  if (!cache) {
    cache = elementImpl._ownerDocument._customPropertyCache = new WeakMap();
  }

  const cached = cache.get(elementImpl);

  if (cached && !own) {
    return cached;
  }

  const parent = elementImpl.parentNode;
  const inherited = parent && parent.nodeType === 1
    ? customPropertiesForElement(parent, null)
    : null;

  const declared = own || collectCustomProperties(elementImpl);

  // An element that declares none of its own sees exactly what its parent sees.
  // Sharing that map rather than copying it keeps the scope identifiable, which
  // is what lets two elements in the same scope share a computed declaration —
  // and avoids copying a map per element on the way.
  let properties;

  if (declared.size === 0 && inherited) {
    properties = inherited;
  } else {
    properties = inherited ? new Map(inherited) : new Map();

    for (const [name, value] of declared) {
      properties.set(name, value);
    }

    scopeIds.set(properties, nextScopeId++);
  }

  cache.set(elementImpl, properties);

  return properties;
}

/** The custom properties an element declares, for elements not yet styled. */
function collectCustomProperties(elementImpl) {
  const own = new Map();

  forEachMatchingSheetRuleOfElement(elementImpl, rule => {
    forEach.call(rule.style, property => {
      if (property.startsWith("--")) {
        own.set(property, rule.style.getPropertyValue(property));
      }
    });
  });

  forEach.call(elementImpl.style, property => {
    if (property.startsWith("--")) {
      own.set(property, elementImpl.style.getPropertyValue(property));
    }
  });

  return own;
}

exports.getDeclarationForElement = elementImpl => {
  let styleCache = elementImpl._ownerDocument._styleCache;
  if (!styleCache) {
    styleCache = elementImpl._ownerDocument._styleCache = new WeakMap();
  }

  const cachedDeclaration = styleCache.get(elementImpl);
  if (cachedDeclaration) {
    return cachedDeclaration;
  }

  // Only what the signature needs is gathered up front. Walking every matched
  // rule's declarations is the expensive part, and for all but a handful of
  // elements the declaration that comes out is one already built for another.
  const matchedRules = [];
  const matched = [];
  const own = new Map();
  let usesVariables = false;

  forEachMatchingSheetRuleOfElement(elementImpl, (rule, entry) => {
    matchedRules.push(rule);
    matched.push(entry.order);

    if (entry.usesVariables) {
      usesVariables = true;
    }

    if (entry.customProperties) {
      for (let i = 0; i < entry.customProperties.length; i++) {
        own.set(entry.customProperties[i][0], entry.customProperties[i][1]);
      }
    }
  });

  const inlineStyle = elementImpl.getAttributeNS(null, "style");

  if (inlineStyle) {
    if (inlineStyle.indexOf("var(") !== -1) {
      usesVariables = true;
    }

    forEach.call(elementImpl.style, property => {
      if (property.startsWith("--")) {
        own.set(property, elementImpl.style.getPropertyValue(property));
      }
    });
  }

  const properties = customPropertiesForElement(elementImpl, own);

  // Elements that matched the same rules and carry the same inline style
  // compute the same declaration, and a page has far fewer distinct
  // combinations than elements — a long article has thousands of links that are
  // all styled by exactly the same three rules. Building the declaration means
  // re-parsing every value through the property parser, which is the bulk of
  // what resolving a style costs, so the finished declaration is shared.
  // A value that reads a variable resolves differently in a different scope, so
  // the scope is part of what identifies the result rather than a reason to
  // give up on sharing it.
  const signature = matched.join(",") + "|" + (inlineStyle ?? "") +
    (usesVariables ? "|" + (scopeIds.get(properties) ?? 0) : "");

  let declarationCache = elementImpl._ownerDocument._declarationCache;

  if (!declarationCache) {
    declarationCache = elementImpl._ownerDocument._declarationCache = new Map();
  }

  {
    const shared = declarationCache.get(signature);

    if (shared) {
      styleCache.set(elementImpl, shared);

      return shared;
    }
  }

  const declaration = new CSSStyleDeclaration();

  const entries = [];

  for (let i = 0; i < matchedRules.length; i++) {
    const ruleStyle = matchedRules[i].style;

    forEach.call(ruleStyle, property => entries.push([ruleStyle, property]));
  }

  forEach.call(elementImpl.style, property => entries.push([elementImpl.style, property]));

  for (const [style, property] of entries) {
    const raw = style.getPropertyValue(property);

    // A custom property is stored as written; it is only ever read back by a
    // var(), which does its own substitution.
    if (property.startsWith("--")) {
      declaration.setProperty(property, raw, style.getPropertyPriority(property));
      continue;
    }

    const value = substituteVariables(raw, properties, new Set(), 0);

    // An unresolvable reference leaves the property unset rather than
    // declaring something the parser would reject.
    if (value === null) {
      continue;
    }

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

  declarationCache.set(signature, declaration);

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
    let compound = branch.trim().split(/[\s>+~]+/).pop() || "";

    // A pseudo class, a pseudo element or an attribute predicate narrows which
    // elements match; it never widens it. Dropping them leaves a key that is
    // less specific than the selector, which is exactly what a filter wants:
    // it may let through an element that turns out not to match, but it can
    // never hide one that does. Keeping them instead left a quarter of a real
    // page's rules unindexed — and those were then tested against every element
    // on it, which was most of what resolving a style cost.
    compound = compound
      .replace(/::[a-zA-Z-]+(\([^)]*\))?/g, "")
      .replace(/:[a-zA-Z-]+(\([^)]*\))?/g, "")
      .replace(/\[[^\]]*\]/g, "");

    // "*" and anything still unrecognised is passed through to the real matcher
    // rather than guessed at.
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
