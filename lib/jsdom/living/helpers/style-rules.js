"use strict";
const cssom = require("rrweb-cssom");
const { CSSStyleDeclaration } = require("cssstyle");
const defaultStyleSheet = require("../../browser/default-stylesheet");
const { getSpecifiedColor, getComputedOrUsedColor } = require("./colors");
const { matchesDontThrow } = require("./selectors");
const { matchesMediaList, viewportForWindow } = require("./media-queries");
const { asciiLowercase } = require("./strings");
const { HTML_NS } = require("./namespaces");
const { presentationalHints } = require("./presentational-hints");

const { forEach } = Array.prototype;

let parsedDefaultStyleSheet;
let parsedScriptingStyleSheet;

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
  // https://drafts.csswg.org/css-writing-modes/#direction
  "direction": {
    inherited: true,
    initial: "ltr",
    computedValue: "as-specified"
  },
  // https://drafts.csswg.org/css-text/#white-space-property
  //
  // The UA stylesheet declares `pre` on `pre`, and the text that the
  // declaration is about is in the descendants: without inheritance every one
  // of them reports "" and the layout collapses the runs and wraps them, which
  // is a preformatted block laid out as prose. An RFC in a `<pre>` came out ten
  // times its height that way.
  "white-space": {
    inherited: true,
    initial: "normal",
    computedValue: "as-specified"
  },
  // https://drafts.csswg.org/css-align/#column-row-gap
  //
  // Unset, these reported "" where a browser reports normal. react-virtuoso
  // parses the gap between its rows from row-gap and takes anything but normal
  // for pixels: "" gave NaN, every row offset with it, and its lists emptied
  // themselves as soon as they drew.
  "row-gap": {
    inherited: false,
    initial: "normal",
    computedValue: "as-specified"
  },
  "column-gap": {
    inherited: false,
    initial: "normal",
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

// Cascade sorting.
//
// https://drafts.csswg.org/css-cascade-4/#cascade-sort
//
// Declarations are ordered by origin and importance first, then by the
// specificity of the selector that matched, and only then by document order.
// Document order alone is not an approximation of the cascade: a reset written
// after the rules it precedes — "* { padding: 0 }" below ".main-board {
// padding-bottom: 100% }" — wins every property it names, which is the opposite
// of what a browser computes.

const ORIGIN_UA = 0;
const ORIGIN_AUTHOR = 1;

// Low to high. A declaration's tier outranks its specificity, and an important
// declaration leaves its origin's normal tier for the important one.
const TIER_UA = 0;
const TIER_AUTHOR = 1;
const TIER_INLINE = 2;
const TIER_AUTHOR_IMPORTANT = 3;
const TIER_INLINE_IMPORTANT = 4;
const TIER_UA_IMPORTANT = 5;

// The three specificity counts are packed into one number so a rank is a single
// comparison. Each bucket holds a count no real selector reaches, and a count
// that would overflow is clamped rather than allowed to borrow from the bucket
// above it.
const SPECIFICITY_ID = 0x10000;
const SPECIFICITY_CLASS = 0x100;
const SPECIFICITY_MAX_PER_BUCKET = 255;

// One above the largest packed specificity, so a tier never overlaps the tier
// below it.
const TIER_SCALE = 0x1000000;

const IDENT_START = /[a-zA-Z_\u00a0-\uffff-]/;
const IDENT_CHAR = /[a-zA-Z0-9_\u00a0-\uffff-]/;

// A functional pseudo-class that takes the specificity of its most specific
// argument instead of that of a pseudo-class.
const SPECIFICITY_FROM_ARGUMENT = new Set(["is", "not", "has", "matches", "-moz-any", "-webkit-any"]);

// The pseudo-elements CSS2 spelled with one colon, which are pseudo-elements
// however they are written.
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

/** Splits a selector list at the commas that separate its complex selectors. */
function splitSelectorList(selectorText) {
  const branches = [];
  let depth = 0;
  let quote = null;
  let start = 0;

  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i];

    if (quote !== null) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === "(" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "]") {
      depth--;
    } else if (ch === "," && depth === 0) {
      branches.push(selectorText.slice(start, i));
      start = i + 1;
    }
  }

  branches.push(selectorText.slice(start));

  return branches;
}

/** The index just past the identifier starting at `i`. */
function readIdent(selector, i) {
  let j = i;

  while (j < selector.length) {
    const ch = selector[j];

    if (ch === "\\") {
      j += 2;
      continue;
    }

    if (!IDENT_CHAR.test(ch)) {
      break;
    }

    j++;
  }

  return j;
}

/** The index just past the bracket or parenthesis opened at `i`. */
function skipBalanced(selector, i) {
  const open = selector[i];
  const close = open === "(" ? ")" : "]";
  let depth = 0;
  let quote = null;

  for (let j = i; j < selector.length; j++) {
    const ch = selector[j];

    if (quote !== null) {
      if (ch === "\\") {
        j++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;

      if (depth === 0) {
        return j + 1;
      }
    }
  }

  return selector.length;
}

// https://drafts.csswg.org/selectors-4/#specificity-rules
//
// Counts ids, then classes/attributes/pseudo-classes, then types/pseudo-
// elements, over one complex selector. An unrecognised construct is counted as
// nothing rather than guessed at: a specificity that is too low leaves the
// declaration where document order already put it, while one that is too high
// moves it above declarations that should beat it.
function specificityOf(selector) {
  let ids = 0;
  let classes = 0;
  let types = 0;
  let i = 0;

  while (i < selector.length) {
    const ch = selector[i];

    if (ch === "#") {
      ids++;
      i = readIdent(selector, i + 1);
    } else if (ch === ".") {
      classes++;
      i = readIdent(selector, i + 1);
    } else if (ch === "[") {
      classes++;
      i = skipBalanced(selector, i);
    } else if (ch === ":" && selector[i + 1] === ":") {
      // A pseudo-element counts as a type selector.
      types++;

      const end = readIdent(selector, i + 2);

      i = selector[end] === "(" ? skipBalanced(selector, end) : end;
    } else if (ch === ":") {
      const end = readIdent(selector, i + 1);
      const name = selector.slice(i + 1, end).toLowerCase();
      const hasArgument = selector[end] === "(";
      const after = hasArgument ? skipBalanced(selector, end) : end;

      if (hasArgument && SPECIFICITY_FROM_ARGUMENT.has(name)) {
        let best = 0;

        for (const branch of splitSelectorList(selector.slice(end + 1, after - 1))) {
          const value = specificityOf(branch);

          if (value > best) {
            best = value;
          }
        }

        ids += Math.floor(best / SPECIFICITY_ID);
        classes += Math.floor(best / SPECIFICITY_CLASS) % SPECIFICITY_CLASS;
        types += best % SPECIFICITY_CLASS;
      } else if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
        types++;
      } else if (name !== "where") {
        // :where() contributes nothing; every other pseudo-class counts as one.
        classes++;
      }

      i = after;
    } else if (ch === "\\" || IDENT_START.test(ch)) {
      const end = readIdent(selector, i);

      if (selector[end] === "|" && selector[end + 1] !== "|") {
        // A namespace prefix is not a type selector; what follows the bar is.
        i = end + 1;
      } else {
        types++;
        i = end;
      }
    } else {
      // "*", combinators and whitespace carry no specificity.
      i++;
    }
  }

  return Math.min(ids, SPECIFICITY_MAX_PER_BUCKET) * SPECIFICITY_ID +
    Math.min(classes, SPECIFICITY_MAX_PER_BUCKET) * SPECIFICITY_CLASS +
    Math.min(types, SPECIFICITY_MAX_PER_BUCKET);
}

// The specificity a rule carries, worked out once when it is indexed.
//
// A selector list whose branches all carry the same specificity — the common
// case, and every rule with a single selector — needs no per-element work, so
// the branches are kept only when they disagree and the cascade has to ask
// which of them matched.
function specificityOfRule(rule) {
  // Trimmed, because a branch is handed back to the selector engine on its own.
  const branchSelectors = splitSelectorList(rule.selectorText).map(branch => branch.trim());
  const branchSpecificities = branchSelectors.map(specificityOf);
  const specificity = branchSpecificities.reduce((a, b) => (a > b ? a : b), 0);

  if (branchSpecificities.every(value => value === specificity)) {
    return { specificity, branchSpecificities: null, branchSelectors: null, branchRanking: null };
  }

  const branchRanking = branchSpecificities
    .map((value, i) => i)
    .sort((a, b) => branchSpecificities[b] - branchSpecificities[a]);

  return { specificity, branchSpecificities, branchSelectors, branchRanking };
}

// The specificity of a rule as it applies to one element: that of the complex
// selector that matched, and of the most specific one where several do.
function specificityForElement(entry, elementImpl) {
  const branches = entry.branchSpecificities;

  if (branches === null) {
    return entry.specificity;
  }

  // Most specific first, so the first branch that matches is the answer.
  for (let i = 0; i < entry.branchRanking.length; i++) {
    const branch = entry.branchRanking[i];

    if (matchesDontThrow(elementImpl, entry.branchSelectors[branch])) {
      return branches[branch];
    }
  }

  // The element matched the list but no branch of it on its own, which means
  // the list was split somewhere this cannot read. The highest is the safe
  // answer: the selector that matched is one of them.
  return entry.specificity;
}

// Whether a media list matches is a property of the viewport, not of the
// element, but the cascade asks once per rule per element. The answer is cached
// against the viewport it was computed for and recomputed when that changes.
const mediaMatchCache = new WeakMap();

// A sheet whose <style> or <link> carries a media attribute applies only while
// that media query list matches: a print sheet is listed in document.styleSheets
// like any other and has no effect on screen.
// https://html.spec.whatwg.org/multipage/semantics.html#attr-link-media
function sheetMediaApplies(sheet, viewport) {
  const media = sheet._ownerElement?.getAttributeNS(null, "media");

  if (media === null || media === undefined || media.trim() === "") {
    return true;
  }

  return matchesMediaList([media], viewport);
}

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
    // @keyframes by name, the last of a name winning: the end states of the
    // animations that fill forwards (animationEndState).
    keyframes: new Map(),
    // What each selector reads, for deciding what a change restyles.
    features: newSelectorFeatures(),
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

  // htmlOnly: the rules apply to HTML elements alone, as under an
  // `@namespace` for the HTML namespace, which the matcher does not read.
  const collect = (rules, origin, htmlOnly = false) => {
    forEach.call(rules, rule => {
      // A conditional group rule contributes its contents only when the
      // condition holds, and those contents can nest further groups. Whether it
      // holds depends on the viewport, which is why the index is rebuilt when
      // the viewport changes.
      // An @import carries a media list of its own and holds no rules: the
      // sheet it names is fetched separately and collected as a sheet. Taken
      // for a group and descended into, the walk was handed nothing and threw,
      // which cost the document every rule in every sheet.
      if (rule.media) {
        if (rule.cssRules && mediaApplies(rule.media, viewport)) {
          collect(rule.cssRules, origin, htmlOnly);
        }
        return;
      }

      // @supports: this engine cannot test a declaration for support, and
      // treating the condition as met matches what a modern browser does for
      // the properties sites actually guard on.
      if (rule.cssRules && typeof rule.conditionText === "string") {
        collect(rule.cssRules, origin, htmlOnly);
        return;
      }

      if (rule.type === 7 && typeof rule.name === "string") {
        index.keyframes.set(rule.name, rule);
        return;
      }

      // Any other grouping rule contributes its contents unconditionally.
      // @layer is the one that matters: a stylesheet written in layers keeps
      // nearly every rule it has inside one, and the rules within are matched
      // on their own selectors like any other.
      if (rule.cssRules) {
        collect(rule.cssRules, origin, htmlOnly);
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

      const entry = {
        rule,
        order: order++,
        origin,
        htmlOnly,
        usesVariables,
        customProperties,
        ...specificityOfRule(rule)
      };

      addSelectorFeatures(index.features, rule.selectorText);

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

  collect(parsedDefaultStyleSheet.cssRules, ORIGIN_UA);

  // The user agent sheet's one rule that depends on the document: where
  // scripts run, nothing of an HTML <noscript> is rendered.
  // https://html.spec.whatwg.org/multipage/rendering.html#hidden-elements
  const scriptingEnabled = Boolean(document._defaultView) &&
    document._defaultView._runScripts === "dangerously" && !document._scriptingDisabled;

  if (scriptingEnabled) {
    if (!parsedScriptingStyleSheet) {
      parsedScriptingStyleSheet = cssom.parse("noscript { display: none !important; }");
    }

    collect(parsedScriptingStyleSheet.cssRules, ORIGIN_UA, true);
  }
  forEach.call(document.styleSheets._list, sheet => {
    if (sheetMediaApplies(sheet, viewport)) {
      collect(sheet.cssRules, ORIGIN_AUTHOR);
    }
  });

  return index;
}

// What a change to the document restyles.
//
// A cached style is thrown away only where a change could alter it. While the
// rule index is built, every selector is read for what it depends on: the
// classes, ids and attributes it names, the attributes behind the pseudo-classes
// it uses (`:checked` is the checked attribute, `:link` is href), and whether it
// counts siblings (`:first-child`, `+`, `~`). Each is recorded with where it sits
// in the selector -- in the compound the element itself must match, in one an
// ancestor must match, or in one a preceding sibling must -- and with what the
// selector's subject carries (its id, a class, its type), which is what an
// element must have to be one the selector could now newly match or stop
// matching. Blink's invalidation sets, in miniature.
//
// A change then re-matches the element it was made to, and beyond it only the
// descendants or later siblings that could be the subject of a selector reading
// what changed. An attribute no selector reads -- aria-expanded, data-*, the
// fork's own image-loaded record -- re-matches the one element, which is found
// unchanged and costs nothing further. Re-matching is done when a style is next
// read, so a burst of changes is settled once.
//
// Inheritance is not invalidation's business: an element's cached style records
// the custom properties of the scope it was resolved in and re-resolves a
// declared `inherit`, and is checked against both whenever anything was found
// changed (_styleGeneration).
//
// `:has()` makes an element's style depend on what is below it or after it. A
// change to anything a `:has()` reads, or to the tree, while a sheet uses one,
// re-matches the ancestors of the change and their earlier siblings that carry
// what a `:has()` compound does, and from each of those, what depends on it. A
// change while a sheet holds a selector this could not read re-matches the
// document, as every change used to.

const STRUCTURE = ":structure";
const EMPTY = ":empty";
const HAS = ":has";

const STRUCTURAL_PSEUDOS = new Set([
  "first-child", "last-child", "only-child", "nth-child", "nth-last-child",
  "first-of-type", "last-of-type", "only-of-type", "nth-of-type", "nth-last-of-type"
]);

// The pseudo-classes an attribute decides, and that attribute.
const PSEUDO_ATTRIBUTES = {
  "checked": ["checked", "selected"],
  "default": ["checked", "selected"],
  "disabled": ["disabled"],
  "enabled": ["disabled"],
  "link": ["href"],
  "any-link": ["href"],
  "visited": ["href"],
  "local-link": ["href"],
  "lang": ["lang"],
  "dir": ["dir"],
  "required": ["required"],
  "optional": ["required"],
  "read-only": ["readonly", "disabled", "contenteditable"],
  "read-write": ["readonly", "disabled", "contenteditable"],
  "placeholder-shown": ["placeholder", "value"],
  "open": ["open"],
  "popover-open": ["popover"],
  "indeterminate": ["indeterminate"]
};

// Pseudo-classes no attribute decides: interaction state is not something a
// mutation reports, and was never invalidated by one.
const ATTRIBUTE_FREE_PSEUDOS = new Set([
  "hover", "focus", "focus-visible", "focus-within", "active", "target", "target-within",
  "root", "scope", "defined", "host", "host-context",
  "before", "after", "first-line", "first-letter"
]);

// Pseudo-classes whose argument is a selector the element, or an ancestor of
// it, is matched against.
const SELECTOR_ARGUMENT_PSEUDOS = new Set([
  "not", "is", "where", "matches", "-webkit-any", "-moz-any",
  "nth-child", "nth-last-child", "host", "host-context"
]);

const ANY_SUBJECT = { any: true, keys: null };

function newSelectorFeatures() {
  return {
    subject: new Map(),
    ancestor: new Map(),
    sibling: new Map(),
    // Read inside :has(), and what the compounds :has() sits in carry.
    viaHas: new Set(),
    hasAnchors: new Map(),
    // Read by a selector inside a selector argument: `:is(.a .b)`.
    inComplexArgument: new Set(),
    // Read inside :has() by such a selector, which can reach above the
    // compound :has() sits in, or across from it, where its anchors are not
    // looked for.
    viaHasAnywhere: new Set(),
    usesHas: false,
    // A selector this could not read.
    opaque: false
  };
}

function addFeature(map, feature, subject) {
  let target = map.get(feature);

  if (!target) {
    target = { any: false, keys: new Set() };
    map.set(feature, target);
  }

  if (subject.any) {
    target.any = true;
  } else {
    for (const key of subject.keys) {
      target.keys.add(key);
    }
  }
}

function unescapeIdent(text) {
  return text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([\s\S])/g, (all, hex, ch) => {
    return hex ? String.fromCodePoint(parseInt(hex, 16) || 0xFFFD) : ch;
  });
}

/**
 * A complex selector's compounds, each with the combinator to its right (null
 * for the last), or null where the text does not split cleanly.
 */
function splitCompounds(selector) {
  const compounds = [];
  let start = 0;
  let i = 0;
  const text = selector.trim();

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\") {
      i += 2;
      continue;
    }

    if (ch === "(" || ch === "[") {
      const end = skipBalanced(text, i);

      if (end >= text.length && text[text.length - 1] !== (ch === "(" ? ")" : "]")) {
        return null;
      }

      i = end;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      return null;
    }

    if (/[\s>+~]/.test(ch)) {
      const compound = text.slice(start, i);
      let j = i;
      let combinator = " ";

      while (j < text.length && /[\s>+~]/.test(text[j])) {
        if (text[j] !== " " && !/\s/.test(text[j])) {
          combinator = text[j];
        }
        j++;
      }

      if (compound) {
        compounds.push({ text: compound, combinator });
      } else if (compounds.length > 0) {
        // `a > b` reads as `a`, whitespace and `>`: the last one written wins.
        compounds[compounds.length - 1].combinator = combinator;
      } else {
        // A selector that begins with a combinator is a relative one, which
        // only :has() takes.
        return null;
      }

      start = j;
      i = j;
      continue;
    }

    i++;
  }

  const last = text.slice(start);

  if (!last) {
    return null;
  }

  compounds.push({ text: last, combinator: null });

  return compounds;
}

/** What an element must carry to be the subject of a compound: its id, a class, or its type. */
function subjectOf(compound) {
  let tag = null;
  let className = null;

  for (let i = 0; i < compound.length;) {
    const ch = compound[i];

    if (ch === "#") {
      const end = readIdent(compound, i + 1);
      return { any: false, keys: new Set(["#" + unescapeIdent(compound.slice(i + 1, end))]) };
    }

    if (ch === "." && className === null) {
      const end = readIdent(compound, i + 1);
      className = "." + unescapeIdent(compound.slice(i + 1, end));
      i = end;
      continue;
    }

    if (ch === "(" || ch === "[") {
      i = skipBalanced(compound, i);
      continue;
    }

    if (i === 0 && ch !== "*" && ch !== ":" && ch !== ".") {
      const end = readIdent(compound, i);

      if (end > i) {
        tag = asciiLowercase(unescapeIdent(compound.slice(i, end)));
        i = end;
        continue;
      }
    }

    i++;
  }

  if (className !== null) {
    return { any: false, keys: new Set([className]) };
  }

  return tag !== null ? { any: false, keys: new Set([tag]) } : ANY_SUBJECT;
}

/** Records what one compound reads, under `map`, for selectors whose subject is `subject`. */
function addCompoundFeatures(features, compound, map, subject) {
  for (let i = 0; i < compound.length;) {
    const ch = compound[i];

    if (ch === "\\") {
      i = readIdent(compound, i);
      continue;
    }

    if (ch === "." || ch === "#") {
      const end = readIdent(compound, i + 1);
      addFeature(map, ch + unescapeIdent(compound.slice(i + 1, end)), subject);
      i = end;
      continue;
    }

    if (ch === "[") {
      const end = skipBalanced(compound, i);
      const name = /^\s*(?:(?:[\w-]*|\*)\|)?((?:[^\s~|^$*=!\]\\]|\\.)+)/.exec(compound.slice(i + 1, end - 1));

      if (name) {
        addFeature(map, "[" + asciiLowercase(unescapeIdent(name[1])), subject);
      } else {
        features.opaque = true;
      }

      i = end;
      continue;
    }

    if (ch === ":") {
      const element = compound[i + 1] === ":";
      const nameStart = i + (element ? 2 : 1);
      const nameEnd = readIdent(compound, nameStart);
      const name = asciiLowercase(compound.slice(nameStart, nameEnd));
      let argument = null;
      i = nameEnd;

      if (compound[i] === "(") {
        const end = skipBalanced(compound, i);
        argument = compound.slice(i + 1, end - 1);
        i = end;
      }

      if (element) {
        continue;
      }

      if (name === "has") {
        features.usesHas = true;

        // The compound :has() sits in is styled by what is below it, or after
        // it, and what that compound decides is reached from it as anything
        // else it reads would be.
        addFeature(map, HAS, subject);
        addFeature(features.hasAnchors, HAS, subjectOf(compound));

        if (argument !== null) {
          const sink = newSelectorFeatures();

          for (const branch of splitSelectorList(argument)) {
            addSelectorFeatures(sink, branch.trim().replace(/^[>+~]\s*/, ""));
          }

          for (const positions of [sink.subject, sink.ancestor, sink.sibling]) {
            for (const feature of positions.keys()) {
              features.viaHas.add(feature);
            }
          }

          for (const feature of sink.viaHas) {
            features.viaHas.add(feature);
          }

          for (const feature of sink.inComplexArgument) {
            features.viaHasAnywhere.add(feature);
          }

          for (const feature of sink.viaHasAnywhere) {
            features.viaHasAnywhere.add(feature);
          }

          if (sink.opaque) {
            features.opaque = true;
          }
        }
        continue;
      }

      if (STRUCTURAL_PSEUDOS.has(name)) {
        addFeature(map, STRUCTURE, subject);
      } else if (name === "empty") {
        addFeature(map, EMPTY, subject);
      } else if (PSEUDO_ATTRIBUTES[name]) {
        for (const attribute of PSEUDO_ATTRIBUTES[name]) {
          addFeature(map, "[" + attribute, subject);
        }
      } else if (!ATTRIBUTE_FREE_PSEUDOS.has(name) && !SELECTOR_ARGUMENT_PSEUDOS.has(name)) {
        // Something decided by state this cannot name: any attribute of the
        // element may be it.
        addFeature(map, "[*", subject);
      }

      if (argument !== null && SELECTOR_ARGUMENT_PSEUDOS.has(name)) {
        const nth = name === "nth-child" || name === "nth-last-child";
        const selectors = nth ? (/\bof\b([\s\S]*)$/i.exec(argument) || [null, null])[1] : argument;

        if (selectors !== null) {
          for (const branch of splitSelectorList(selectors)) {
            const compounds = splitCompounds(branch);

            if (!compounds) {
              features.opaque = true;
              continue;
            }

            // One compound is a further condition on this one. A complex
            // selector reaches up and across as well, to elements this does
            // not know the subjects of.
            if (compounds.length === 1) {
              addCompoundFeatures(features, compounds[0].text, map, subject);
            } else {
              for (const each of compounds) {
                addCompoundFeatures(features, each.text, map, subject);
                addCompoundFeatures(features, each.text, features.ancestor, ANY_SUBJECT);
                addCompoundFeatures(features, each.text, features.sibling, ANY_SUBJECT);

                const read = newSelectorFeatures();
                addCompoundFeatures(read, each.text, read.subject, ANY_SUBJECT);

                for (const feature of read.subject.keys()) {
                  features.inComplexArgument.add(feature);
                }

                // Which element is next to which is read as well.
                if (each.combinator === "+" || each.combinator === "~") {
                  features.inComplexArgument.add(STRUCTURE);
                }
              }
            }
          }
        }
      }
      continue;
    }

    i++;
  }
}

function addSelectorFeatures(features, selectorText) {
  // The parser reads an @namespace rule as the start of the selector after it.
  selectorText = selectorText.replace(/^\s*@namespace[^;]*;\s*/i, "");

  for (const branch of splitSelectorList(selectorText)) {
    const compounds = splitCompounds(branch);

    if (!compounds) {
      features.opaque = true;
      continue;
    }

    const subject = subjectOf(compounds[compounds.length - 1].text);
    let countsSiblings = false;

    for (let i = 0; i < compounds.length; i++) {
      const { text, combinator } = compounds[i];
      let map = features.subject;

      if (combinator === "+" || combinator === "~") {
        map = features.sibling;
        countsSiblings = true;
      } else if (combinator !== null) {
        map = features.ancestor;
      }

      addCompoundFeatures(features, text, map, subject);
    }

    // Which element is next to which changes with the children.
    if (countsSiblings) {
      addFeature(features.sibling, STRUCTURE, subject);
    }
  }
}

function carriesAny(element, target) {
  if (target.any) {
    return true;
  }

  const { keys } = target;

  if (keys.has(asciiLowercase(element._localName))) {
    return true;
  }

  const id = element.getAttributeNS(null, "id");

  if (id && keys.has("#" + id)) {
    return true;
  }

  const className = element.getAttributeNS(null, "class");

  if (className) {
    const names = className.split(/\s+/);

    for (let i = 0; i < names.length; i++) {
      if (names[i] && keys.has("." + names[i])) {
        return true;
      }
    }
  }

  return false;
}

/** Whether an element carries a class, an id or an attribute in `set`. */
function carriesFeature(element, set) {
  const id = element.getAttributeNS(null, "id");

  if (id && set.has("#" + id)) {
    return true;
  }

  for (const attribute of element._attributeList) {
    if (set.has("[" + asciiLowercase(attribute._localName))) {
      return true;
    }
  }

  const className = element.getAttributeNS(null, "class");

  return Boolean(className) && className.split(/\s+/).some(name => name && set.has("." + name));
}

function pendingInvalidations(document) {
  if (!document._styleInvalidations) {
    document._styleInvalidations = {
      changed: new Map(),
      children: new Set(),
      inserted: new Set(),
      removed: new Set(),
      all: false
    };
  }

  return document._styleInvalidations;
}

// Nothing has been styled where there is no rule index, so there is nothing to
// keep up to date.
function styled(nodeImpl) {
  return Boolean(nodeImpl._ownerDocument && nodeImpl._ownerDocument._ruleIndex);
}

/** An attribute of an element changed; `name` is "selected" for an option's selectedness. */
exports.styleAttributeChanged = (elementImpl, name, value, oldValue) => {
  if (!elementImpl._attached || !styled(elementImpl)) {
    return;
  }

  const { changed } = pendingInvalidations(elementImpl._ownerDocument);
  let features = changed.get(elementImpl);

  if (!features) {
    features = new Set();
    changed.set(elementImpl, features);
  }

  features.add("[" + asciiLowercase(name));
  features.add("[*");

  if (name === "class") {
    const before = new Set((oldValue || "").split(/\s+/).filter(Boolean));
    const after = new Set((value || "").split(/\s+/).filter(Boolean));

    for (const token of before) {
      if (!after.has(token)) {
        features.add("." + token);
      }
    }

    for (const token of after) {
      if (!before.has(token)) {
        features.add("." + token);
      }
    }
  } else if (name === "id") {
    if (oldValue) {
      features.add("#" + oldValue);
    }

    if (value) {
      features.add("#" + value);
    }
  }
};

/** A child of `parentImpl` was inserted (`insertedImpl`), or `removedImpl` was removed from it. */
exports.styleChildrenChanged = (parentImpl, insertedImpl, removedImpl) => {
  if (!styled(parentImpl)) {
    return;
  }

  const pending = pendingInvalidations(parentImpl._ownerDocument);

  if (parentImpl.nodeType !== 1) {
    pending.all = true;
    return;
  }

  if (!parentImpl._attached) {
    return;
  }

  pending.children.add(parentImpl);

  if (insertedImpl && insertedImpl.nodeType === 1) {
    pending.inserted.add(insertedImpl);
  }

  if (removedImpl && removedImpl.nodeType === 1) {
    pending.removed.add(removedImpl);
  }
};

/** The text inside an element changed, which only :empty and :has() can see. */
exports.styleTextChanged = elementImpl => {
  if (elementImpl.nodeType !== 1 || !elementImpl._attached || !styled(elementImpl)) {
    return;
  }

  const features = pendingInvalidations(elementImpl._ownerDocument).changed;

  if (!features.has(elementImpl)) {
    features.set(elementImpl, new Set());
  }

  features.get(elementImpl).add(EMPTY);
};

/** Re-matches every element of the document, for a change this cannot follow. */
exports.restyleDocument = documentImpl => {
  documentImpl._sharedComputedStyles = null;
  documentImpl._matchCache = null;
  documentImpl._styleCache = null;
  documentImpl._computedStyleCache = null;
  documentImpl._customPropertyCache = null;
  documentImpl._ancestorKeyCache = null;
  documentImpl._styleInvalidations = null;
  documentImpl._styleGeneration = (documentImpl._styleGeneration || 0) + 1;
};

function forEachElementBelow(elementImpl, visit) {
  for (let child = elementImpl.firstElementChild; child; child = child.nextElementSibling) {
    visit(child);
    forEachElementBelow(child, visit);
  }
}

function flushStyleInvalidations(document) {
  const pending = document._styleInvalidations;

  if (!pending || document._flushingStyleInvalidations) {
    return;
  }

  document._styleInvalidations = null;

  const index = document._ruleIndex;

  if (!index) {
    return;
  }

  const { features } = index;
  const rematch = new Set();
  const ancestorKeys = document._ancestorKeyCache;
  let everything = pending.all;

  // Whatever is below an element whose classes or id changed has a stale record
  // of its ancestors' keys.
  function forgetAncestorKeys(element) {
    if (ancestorKeys) {
      ancestorKeys.delete(element);
    }
  }

  function reach(element, feature, downward = true) {
    const below = downward && features.ancestor.get(feature);
    const after = features.sibling.get(feature);
    const self = features.subject.get(feature);

    if (self && carriesAny(element, self)) {
      rematch.add(element);
    }

    if (below) {
      forEachElementBelow(element, each => {
        if (carriesAny(each, below)) {
          rematch.add(each);
        }
      });
    }

    if (after) {
      for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (carriesAny(sibling, after)) {
          rematch.add(sibling);
        }

        forEachElementBelow(sibling, each => {
          if (carriesAny(each, after)) {
            rematch.add(each);
          }
        });
      }
    }
  }

  // The elements whose :has() a change at `element` can answer differently:
  // it and its ancestors, and the siblings before each. Collected first, and
  // reached once each when everything pending has been read.
  const anchors = features.hasAnchors.get(HAS);
  const hasAnchorsReached = new Set();
  function reachHasAnchors(element) {
    if (!anchors) {
      return;
    }

    for (let up = element; up && up.nodeType === 1; up = up.parentNode) {
      for (let each = up; each; each = each.previousElementSibling) {
        if (carriesAny(each, anchors)) {
          hasAnchorsReached.add(each);
        }
      }
    }
  }

  for (const [element, changed] of pending.changed) {
    if (everything) {
      break;
    }

    if (!element._attached) {
      continue;
    }

    rematch.add(element);

    for (const feature of changed) {
      if ((features.opaque && feature !== EMPTY) || features.viaHasAnywhere.has(feature)) {
        everything = true;
        break;
      }

      if (features.viaHas.has(feature) || feature === EMPTY) {
        reachHasAnchors(element);
      }

      if (feature[0] === "." || feature[0] === "#") {
        forgetAncestorKeys(element);
        forEachElementBelow(element, forgetAncestorKeys);
      }

      reach(element, feature);
    }
  }

  // An element added or removed that carries what a :has() reads from
  // anywhere has to be followed everywhere.
  if (!everything && features.viaHasAnywhere.size > 0) {
    if (features.viaHasAnywhere.has(STRUCTURE) && pending.children.size > 0) {
      everything = true;
    }

    for (const root of [...pending.inserted, ...pending.removed]) {
      if (everything) {
        break;
      }

      const elements = [root];
      forEachElementBelow(root, each => elements.push(each));

      everything = elements.some(each => carriesFeature(each, features.viaHasAnywhere));
    }
  }

  if (!everything) {
    for (const element of pending.inserted) {
      if (!element._attached) {
        continue;
      }

      // Moved, it is under different ancestors and beside different siblings.
      rematch.add(element);
      forgetAncestorKeys(element);
      forEachElementBelow(element, each => {
        rematch.add(each);
        forgetAncestorKeys(each);
      });
    }

    for (const parent of pending.children) {
      if (!parent._attached) {
        continue;
      }

      rematch.add(parent);
      reach(parent, EMPTY);
      // From the last child, whose earlier siblings are every child: a
      // `:has(~ x)` anchor is beside what changed, not above it.
      reachHasAnchors(parent.lastElementChild || parent);

      for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
        const self = features.subject.get(STRUCTURE);
        const below = features.ancestor.get(STRUCTURE);
        const across = features.sibling.get(STRUCTURE);

        if ((self && carriesAny(child, self)) || (across && carriesAny(child, across))) {
          rematch.add(child);
        }

        if (below || across) {
          forEachElementBelow(child, each => {
            if ((below && carriesAny(each, below)) || (across && carriesAny(each, across))) {
              rematch.add(each);
            }
          });
        }
      }
    }
  }

  // What is below one anchor is below any anchor above it, so only the
  // outermost are walked down from.
  for (const anchor of hasAnchorsReached) {
    let outermost = true;

    for (let up = anchor.parentNode; up && up.nodeType === 1; up = up.parentNode) {
      if (hasAnchorsReached.has(up)) {
        outermost = false;
        break;
      }
    }

    rematch.add(anchor);
    reach(anchor, HAS, outermost);
  }

  if (everything) {
    exports.restyleDocument(document);
    return;
  }

  if (rematch.size === 0) {
    return;
  }

  // Re-matched now rather than when read, so that only a change that changed
  // something sends everything else to be checked against it.
  const matchCache = document._matchCache;
  const styleCache = document._styleCache;
  const propertyCache = document._customPropertyCache;
  const before = new Map();

  for (const element of rematch) {
    const style = styleCache && styleCache.get(element);
    const scope = propertyCache && propertyCache.get(element);

    before.set(element, { declaration: style && style.declaration, properties: scope && scope.properties });

    if (matchCache) {
      matchCache.delete(element);
    }

    if (style) {
      style.generation = NaN;
    }

    if (scope) {
      scope.generation = NaN;
    }
  }

  let changed = false;

  document._flushingStyleInvalidations = true;

  try {
    for (const [element, was] of before) {
      if (!element._attached) {
        changed = true;
        continue;
      }

      if (exports.getDeclarationForElement(element) !== was.declaration ||
        customPropertiesForElement(element) !== was.properties) {
        changed = true;
      }
    }
  } finally {
    document._flushingStyleInvalidations = false;
  }

  if (changed) {
    document._styleGeneration = (document._styleGeneration || 0) + 1;
  }
}

const DECLARATION_CACHE_LIMIT = 50000;

function ruleIndexFor(document, viewport) {
  const cached = document._ruleIndex;

  if (cached &&
    cached.viewport.width === viewport.width &&
    cached.viewport.height === viewport.height &&
    cached.viewport.pixelRatio === viewport.pixelRatio) {
    return cached;
  }

  // A declaration is cached under the order of the rules it was built from,
  // which a new index numbers afresh; what was matched against the old one is
  // known stale by the index it records.
  document._ruleIndex = buildRuleIndex(document, viewport);
  document._declarationCache = null;
  document._styleGeneration = (document._styleGeneration || 0) + 1;

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

  // A type selector is indexed under its ASCII lowercased name. An element's
  // `_localName` is lowercase only where the HTML parser made it so: an SVG
  // `clipPath`, `linearGradient` or `feGaussianBlur` keeps the case it was
  // written in, and asking for that bucket verbatim found none — `clipPath {}`
  // matched the element and never reached its computed style.
  const localName = asciiLowercase(elementImpl._localName);

  gather(index.byTag.get(localName));

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
    const { rule, htmlOnly } = candidates[i];

    if (htmlOnly && elementImpl._namespaceURI !== HTML_NS) {
      continue;
    }

    if (matches(rule, elementImpl, localName)) {
      handleRule(rule, candidates[i]);
    }
  }
}

// The style sheets changed: everything is matched again, against a new index.
// Asked by the element that owns the sheet, which is no longer attached when
// the change is its removal.
exports.invalidateStyleCache = elementImpl => {
  const document = elementImpl._ownerDocument;

  if (document) {
    document._ruleIndex = null;
    document._declarationCache = null;
    exports.restyleDocument(document);
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

/**
 * The custom properties in scope at an element, its own over its parent's. The
 * same map is handed back for as long as neither changes: its identity is the
 * scope a declaration that reads a variable was resolved in.
 */
function customPropertiesForElement(elementImpl) {
  const document = elementImpl._ownerDocument;
  if (!document._customPropertyCache) {
    document._customPropertyCache = new WeakMap();
  }

  const cache = document._customPropertyCache;
  const generation = document._styleGeneration;
  const cached = cache.get(elementImpl);

  if (cached && cached.generation === generation) {
    return cached.properties;
  }

  const parent = elementImpl.parentNode;
  const inherited = parent && parent.nodeType === 1
    ? customPropertiesForElement(parent)
    : null;
  const declared = matchRecordFor(elementImpl).own;

  // An element that declares none of its own sees exactly what its parent sees.
  // Sharing that map rather than copying it keeps the scope identifiable, which
  // is what lets two elements in the same scope share a computed declaration —
  // and avoids copying a map per element on the way.
  let properties;

  if (declared.size === 0 && inherited) {
    properties = inherited;
  } else if (cached && cached.inherited === inherited && sameEntries(cached.declared, declared)) {
    properties = cached.properties;
  } else {
    properties = inherited ? new Map(inherited) : new Map();

    for (const [name, value] of declared) {
      properties.set(name, value);
    }

    scopeIds.set(properties, nextScopeId++);
  }

  cache.set(elementImpl, { properties, inherited, declared, generation });

  return properties;
}

function sameEntries(a, b) {
  if (a === b) {
    return true;
  }

  if (a.size !== b.size) {
    return false;
  }

  for (const [name, value] of a) {
    if (b.get(name) !== value) {
      return false;
    }
  }

  return true;
}

// The rules matching an element, in cascade order: origin first, then the
// specificity of the selector that matched, then document order.
function matchedEntriesInCascadeOrder(elementImpl) {
  const matched = [];

  forEachMatchingSheetRuleOfElement(elementImpl, (rule, entry) => {
    const specificity = specificityForElement(entry, elementImpl);

    matched.push({
      entry,
      specificity,
      rank: (entry.origin === ORIGIN_UA ? TIER_UA : TIER_AUTHOR) * TIER_SCALE + specificity
    });
  });

  // The list is built in document order and the sort is stable, which is what
  // leaves rules of equal rank in it.
  matched.sort((a, b) => a.rank - b.rank);

  return matched;
}

// The properties an element declares "inherit" on, against the declaration the
// cascade produced. They cannot be resolved into it: a declaration is shared by
// every element the same rules matched, and those elements have different
// parents.
const inheritedDeclarations = new WeakMap();

// Units resolved against something the value is not carried with: the font it
// was declared in, the root font, the viewport, or the parent's own value.
const RELATIVE_UNIT = /(\d|\.)\s*(em|ex|ch|rem|vw|vh|vmin|vmax|cap|ic|lh|rlh)\b|%/i;

// https://drafts.csswg.org/css-cascade-4/#valdef-all-inherit
function inheritedValueFor(elementImpl, property) {
  const parent = elementImpl.parentElement;

  if (parent === null) {
    // The root has nothing to inherit from, which leaves the initial value.
    // It is known only for the properties below; for the rest the property is
    // dropped, and a reader that finds nothing substitutes its own initial.
    const resolvable = exports.propertiesWithResolvedValueImplemented[property];

    return resolvable ? resolvable.initial : "";
  }

  // Font-size inheritance belongs to the layout engine, not here: font-size is
  // not in the table above, so the cascade passes the declared string through
  // and repaint resolves em and % against the parent box. "1em" is what the
  // keyword means in those terms — the parent's size, one level up — where
  // handing down the parent's own relative value would resolve it twice.
  if (property === "font-size") {
    return "1em";
  }

  // What inheritance passes down is the parent's computed value, which is
  // available for the properties above. For the rest the parent's own declared
  // value is all there is, so a property declared nowhere up the chain ends up
  // dropped rather than carrying a value from further up.
  const value = property in exports.propertiesWithResolvedValueImplemented
    ? getComputedValue(parent, property)
    : exports.getDeclarationForElement(parent).getPropertyValue(property);

  // Inheritance passes down an absolute value, and these are not absolutized
  // here: a length is reported as the string the page declared. Passing one
  // down applies it twice, against the parent's font and then the child's —
  // "font-size: inherit" under a parent that declares "1.5em" is 2.25em. So a
  // value that still carries a relative unit is dropped, leaving the reader its
  // own initial, as an unresolved "inherit" did. A unitless number is not one
  // of these: a line-height number is what inheritance passes down.
  return RELATIVE_UNIT.test(value) ? "" : value;
}

function withInheritResolved(elementImpl, template, signature, declarationCache) {
  const inherited = inheritedDeclarations.get(template);

  if (inherited === undefined) {
    return template;
  }

  const resolved = [];

  for (const [property, priority] of inherited) {
    resolved.push([property, inheritedValueFor(elementImpl, property), priority]);
  }

  // Keyed beside the signature so the sharing survives: a page whose "*" rule
  // says "box-sizing: inherit" declares it on every element, and every element
  // under the same root resolves it to the same value.
  const key = signature + "|inherit:" +
    resolved.map(([property, value]) => property + "=" + value).join(";");
  const cached = declarationCache.get(key);

  if (cached) {
    return cached;
  }

  const declaration = new CSSStyleDeclaration();

  forEach.call(template, property => {
    declaration.setProperty(
      property,
      template.getPropertyValue(property),
      template.getPropertyPriority(property)
    );
  });

  for (const [property, value, priority] of resolved) {
    if (value === "") {
      declaration.removeProperty(property);
    } else {
      declaration.setProperty(property, value, priority);
    }
  }

  declarationCache.set(key, declaration);

  return declaration;
}

/**
 * What an element matched, and everything else about the element itself its
 * style is decided from: its inline style, its presentational hints and the
 * custom properties it declares. Kept until a change could alter it
 * (flushStyleInvalidations), or until the rule index it was matched against
 * is rebuilt.
 */
function matchRecordFor(elementImpl) {
  const document = elementImpl._ownerDocument;
  const index = ruleIndexFor(document, viewportForWindow(document._defaultView));
  if (!document._matchCache) {
    document._matchCache = new WeakMap();
  }

  const cache = document._matchCache;
  const cached = cache.get(elementImpl);

  if (cached && cached.index === index) {
    return cached;
  }

  // Only what the signature needs is gathered up front. Walking every matched
  // rule's declarations is the expensive part, and for all but a handful of
  // elements the declaration that comes out is one already built for another.
  const entries = matchedEntriesInCascadeOrder(elementImpl);
  const matched = [];
  const own = new Map();
  let usesVariables = false;

  for (let i = 0; i < entries.length; i++) {
    const { entry, rank } = entries[i];

    // Where a rule's selector list carries branches of differing specificity,
    // two elements can match the same rules and still cascade them in different
    // orders, so the resolved rank identifies the result along with the rule.
    matched.push(entry.branchSpecificities === null ? entry.order : entry.order + ":" + rank);

    if (entry.usesVariables) {
      usesVariables = true;
    }

    if (entry.customProperties) {
      for (let j = 0; j < entry.customProperties.length; j++) {
        own.set(entry.customProperties[j][0], entry.customProperties[j][1]);
      }
    }
  }

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

  const hints = presentationalHints(elementImpl);
  const record = {
    index,
    entries,
    key: matched.join(",") + "|" + (inlineStyle ?? "") +
      (hints.length > 0 ? "|h:" + hints.map(([property, value]) => property + ":" + value).join(";") : ""),
    usesVariables,
    own,
    hints
  };

  cache.set(elementImpl, record);

  return record;
}

exports.getDeclarationForElement = elementImpl => {
  const document = elementImpl._ownerDocument;

  flushStyleInvalidations(document);

  if (!document._styleCache) {
    document._styleCache = new WeakMap();
  }

  const styleCache = document._styleCache;
  const generation = document._styleGeneration;
  const cached = styleCache.get(elementImpl);

  if (cached && cached.generation === generation) {
    return cached.declaration;
  }

  const match = matchRecordFor(elementImpl);
  const properties = customPropertiesForElement(elementImpl);

  let declarationCache = document._declarationCache;

  if (!declarationCache || declarationCache.size > DECLARATION_CACHE_LIMIT) {
    declarationCache = document._declarationCache = new Map();
  }

  // Elements that matched the same rules and carry the same inline style
  // compute the same declaration, and a page has far fewer distinct
  // combinations than elements — a long article has thousands of links that are
  // all styled by exactly the same three rules. Building the declaration means
  // re-parsing every value through the property parser, which is the bulk of
  // what resolving a style costs, so the finished declaration is shared.
  // A value that reads a variable resolves differently in a different scope, so
  // the scope is part of what identifies the result rather than a reason to
  // give up on sharing it.
  const signature = match.key + (match.usesVariables ? "|" + (scopeIds.get(properties) ?? 0) : "");
  let template = cached && cached.signature === signature ? cached.template : declarationCache.get(signature);

  if (!template) {
    template = buildDeclaration(elementImpl, match, properties, signature, declarationCache);
  }

  // A declared "inherit" reads the parent's values, which can have changed
  // under a declaration that did not.
  const declaration = withInheritResolved(elementImpl, template, signature, declarationCache);

  styleCache.set(elementImpl, { declaration, template, signature, generation });

  return declaration;
};

/**
 * An element's computed style, as getComputedStyle answers it, kept for as
 * long as neither its declaration nor its parent's computed style changes --
 * the same object, which a layout engine can key what it derives from it by.
 * Elements beside each other computed from the same declaration share one.
 * Not for a page's scripts, which are owed an object of their own.
 */
exports.computedStyle = elementImpl => {
  const declaration = exports.getDeclarationForElement(elementImpl);
  const document = elementImpl._ownerDocument;
  if (!document._computedStyleCache) {
    document._computedStyleCache = new WeakMap();
  }

  const cache = document._computedStyleCache;
  const generation = document._styleGeneration;
  const cached = cache.get(elementImpl);

  if (cached && cached.generation === generation) {
    return cached.style;
  }

  const parent = elementImpl.parentElement;
  const parentStyle = parent ? exports.computedStyle(parent) : null;

  if (cached && cached.declaration === declaration && cached.parentStyle === parentStyle) {
    cached.generation = generation;
    return cached.style;
  }

  if (!document._sharedComputedStyles) {
    document._sharedComputedStyles = new WeakMap();
  }

  const shared = document._sharedComputedStyles;
  const parentKey = parentStyle || document;
  let byDeclaration = shared.get(parentKey);

  if (!byDeclaration) {
    byDeclaration = new WeakMap();
    shared.set(parentKey, byDeclaration);
  }

  let style = byDeclaration.get(declaration);

  if (!style) {
    style = new CSSStyleDeclaration();

    forEach.call(declaration, property => {
      style.setProperty(property, declaration.getPropertyValue(property), declaration.getPropertyPriority(property));
    });

    // https://drafts.csswg.org/cssom/#dom-window-getcomputedstyle
    for (const property of Object.keys(exports.propertiesWithResolvedValueImplemented)) {
      style.setProperty(property, exports.getResolvedValue(elementImpl, property));
    }

    byDeclaration.set(declaration, style);
  }

  cache.set(elementImpl, { style, declaration, parentStyle, generation });

  return style;
};

function buildDeclaration(elementImpl, match, properties, signature, declarationCache) {
  const declaration = new CSSStyleDeclaration();

  const entries = [];

  // Presentational hints are author declarations of no specificity that come
  // before every author rule, so a rule of no specificity still wins: first in
  // the list, at the lowest author rank, and the sort below is stable.
  const { hints } = match;

  if (hints.length > 0) {
    const hintStyle = new CSSStyleDeclaration();

    for (const [property, value] of hints) {
      hintStyle.setProperty(property, value);
    }

    forEach.call(hintStyle, property => entries.push([hintStyle, property, TIER_AUTHOR * TIER_SCALE]));
  }

  for (let i = 0; i < match.entries.length; i++) {
    const { entry, specificity, rank } = match.entries[i];
    const ruleStyle = entry.rule.style;
    const importantRank =
      (entry.origin === ORIGIN_UA ? TIER_UA_IMPORTANT : TIER_AUTHOR_IMPORTANT) * TIER_SCALE +
      specificity;

    forEach.call(ruleStyle, property => entries.push([
      ruleStyle,
      property,
      ruleStyle.getPropertyPriority(property) === "important" ? importantRank : rank
    ]));
  }

  const inlineRank = TIER_INLINE * TIER_SCALE;
  const inlineImportantRank = TIER_INLINE_IMPORTANT * TIER_SCALE;

  forEach.call(elementImpl.style, property => entries.push([
    elementImpl.style,
    property,
    elementImpl.style.getPropertyPriority(property) === "important" ?
      inlineImportantRank :
      inlineRank
  ]));

  // Importance is decided per declaration, not per rule, so an important one
  // leaves the tier its rule sits in for the important tier above every normal
  // declaration. The rest are already in cascade order and a stable sort leaves
  // them there.
  entries.sort((a, b) => a[2] - b[2]);

  const inherited = new Map();
  const animation = { names: [], fills: [], iterations: [], directions: [] };

  for (const [style, property] of entries) {
    const raw = style.getPropertyValue(property);

    if (property === "animation" || ANIMATION_LONGHANDS[property]) {
      readAnimationDeclaration(animation, property, raw);
    }

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

    const keyword = asciiLowercase(value.trim());

    // https://drafts.csswg.org/css-cascade-4/#valdef-all-unset
    if (keyword === "unset") {
      inherited.delete(property);
      declaration.removeProperty(property);
      continue;
    }

    if (keyword === "inherit") {
      // Kept so the declaration says what the page said, and resolved per
      // element below, where the parent is known.
      inherited.set(property, style.getPropertyPriority(property));
    } else {
      inherited.delete(property);
    }

    declaration.setProperty(
      property,
      value,
      style.getPropertyPriority(property)
    );
  }

  applyAnimationEndStates(elementImpl, declaration, animation, properties);

  // CSS 2.1 §9.7: an absolutely or fixed positioned box does not float.
  const position = asciiLowercase(declaration.getPropertyValue("position").trim());

  if ((position === "absolute" || position === "fixed") && declaration.getPropertyValue("float") !== "") {
    declaration.setProperty("float", "none");
  }

  declarationCache.set(signature, declaration);

  if (inherited.size > 0) {
    inheritedDeclarations.set(declaration, inherited);
  }

  return declaration;
}

// Animations, which nothing here runs. One that fills forwards is, once it has
// run, the style of its last keyframe, and that is what the cascade takes at
// once, above the author's normal declarations and below the important ones:
// a page faded in by an animation otherwise stayed at the opacity it starts
// from. One that does not fill, or never ends, leaves the element as it is.
// https://drafts.csswg.org/css-animations-1/#animation-fill-mode

const ANIMATION_LONGHANDS = {
  "animation-name": "names",
  "animation-fill-mode": "fills",
  "animation-iteration-count": "iterations",
  "animation-direction": "directions"
};

const ANIMATION_FILLS = new Set(["none", "forwards", "backwards", "both"]);
const ANIMATION_DIRECTIONS = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
const ANIMATION_OTHER_KEYWORDS = new Set([
  "running", "paused", "linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"
]);

// Splits on the separator outside parentheses: a comma between animations, or
// whitespace between the parts of one, not those inside cubic-bezier().
function splitOutsideParentheses(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const char of text) {
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (depth === 0 && separator.test(char)) {
      if (current.trim() !== "") {
        parts.push(current.trim());
      }
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
}

// One animation of the shorthand. A time is its duration or delay and a
// function its timing, neither of which matters here; a bare number or
// infinite its iteration count; the rest are keywords, and what is left is its
// name.
function parseAnimationLayer(text) {
  const layer = { name: "none", fill: "none", iteration: "1", direction: "normal" };

  for (const token of splitOutsideParentheses(text, /\s/)) {
    const keyword = asciiLowercase(token);

    if (/^[+-]?(\d+\.?\d*|\.\d+)m?s$/.test(keyword) || keyword.includes("(") ||
        ANIMATION_OTHER_KEYWORDS.has(keyword)) {
      continue;
    }

    if (keyword === "infinite" || /^(\d+\.?\d*|\.\d+)$/.test(keyword)) {
      layer.iteration = keyword;
    } else if (ANIMATION_FILLS.has(keyword) && keyword !== "none") {
      layer.fill = keyword;
    } else if (ANIMATION_DIRECTIONS.has(keyword)) {
      layer.direction = keyword;
    } else if (keyword !== "none") {
      layer.name = token;
    }
  }

  return layer;
}

// Read in cascade order: the shorthand sets every part, and a longhand after
// it overrides its own.
function readAnimationDeclaration(animation, property, value) {
  if (property === "animation") {
    const layers = splitOutsideParentheses(value, /,/).map(parseAnimationLayer);

    animation.names = layers.map(layer => layer.name);
    animation.fills = layers.map(layer => layer.fill);
    animation.iterations = layers.map(layer => layer.iteration);
    animation.directions = layers.map(layer => layer.direction);
    return;
  }

  animation[ANIMATION_LONGHANDS[property]] = splitOutsideParentheses(value, /,/);
}

// Whether an animation that has run its course ends on its first keyframe
// rather than its last.
function endsAtStart(direction, iteration) {
  const count = Math.round(parseFloat(iteration));
  const even = Number.isFinite(count) && count % 2 === 0;

  switch (direction) {
    case "reverse":
      return true;
    case "alternate":
      return even;
    case "alternate-reverse":
      return !even;
    default:
      return false;
  }
}

function applyAnimationEndStates(elementImpl, declaration, animation, properties) {
  if (animation.names.length === 0) {
    return;
  }

  const document = elementImpl._ownerDocument;
  const { keyframes } = ruleIndexFor(document, viewportForWindow(document._defaultView));
  const at = (list, i, fallback) => list.length > 0 ? asciiLowercase(list[i % list.length]) : fallback;

  animation.names.forEach((name, i) => {
    const fill = at(animation.fills, i, "none");
    const iteration = at(animation.iterations, i, "1");
    const rule = keyframes.get(name);

    if (!rule || (fill !== "forwards" && fill !== "both") || iteration === "infinite") {
      return;
    }

    const target = endsAtStart(at(animation.directions, i, "normal"), iteration) ? "0%" : "100%";

    forEach.call(rule.cssRules, keyframe => {
      const offsets = String(keyframe.keyText).split(",").map(offset => {
        const key = asciiLowercase(offset.trim());

        return key === "from" ? "0%" : key === "to" ? "100%" : key;
      });

      if (!offsets.includes(target)) {
        return;
      }

      forEach.call(keyframe.style, property => {
        if (declaration.getPropertyPriority(property) === "important") {
          return;
        }

        const value = substituteVariables(keyframe.style.getPropertyValue(property), properties, new Set(), 0);

        if (value !== null) {
          declaration.setProperty(property, value);
        }
      });
    });
  });
}

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

  // An escaped character belongs to the name it sits in, so it is masked
  // before anything below splits on a comma, a combinator or whitespace: split
  // there, `#a\ b` was a type selector `b` and indexed under that tag. A hex
  // escape takes one whitespace character after it as its terminator. The mask
  // leaves a backslash in the compound, which the key pattern below rejects,
  // so a branch whose rightmost compound holds an escape goes to the matcher.
  selectorText = selectorText.replace(/\\(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[\s\S])/g, "\\_");

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

    // The tag is lowercased and an id and a class are not, which is how each
    // is compared in an HTML document. Whatever a tag key is compared against
    // has to be lowercased the same way: an element's local name is not, for
    // anything the HTML parser did not name.
    cached.push({
      id: id ? id[1] : null,
      classes: classes ? classes.map(c => c.slice(1)) : null,
      tag: tag ? tag[1].toLowerCase() : null,
      ancestors: requiredAncestorKeys(branch),
    });
  }

  return cached;
}

// The ids, classes and types the element's ancestors must carry between them
// for a branch to match: those of every compound with a descendant or child
// combinator to its right. A compound with a sibling combinator to its right
// constrains a sibling, not an ancestor, and contributes nothing. Browsers
// reject most candidate rules this way before matching -- `.header .menu a`
// is tested against every link otherwise, and a theme with 11,000 rules spent
// five milliseconds a link on them. A branch whose ancestors this cannot read
// reliably -- a parenthesis, a bracket, a quote or an escape before its
// rightmost compound -- carries no keys and is matched in full.
function requiredAncestorKeys(branch) {
  const tokens = branch.trim().split(/(\s*[>+~]\s*|\s+)/);

  if (tokens.length < 3 || /[()[\]"'\\]/.test(tokens.slice(0, -2).join(""))) {
    return null;
  }

  const keys = [];

  for (let i = 0; i + 2 < tokens.length; i += 2) {
    const combinator = tokens[i + 1].trim();

    if (combinator !== "" && combinator !== ">") {
      continue;
    }

    const compound = tokens[i].replace(/::?[a-zA-Z-]+/g, "");

    if (!/^[a-zA-Z0-9_\-#.*]+$/.test(compound)) {
      continue;
    }

    const id = compound.match(/#([\w-]+)/);
    const classes = compound.match(/\.([\w-]+)/g);
    const tag = compound.match(/^([a-zA-Z][\w-]*)/);

    if (id) {
      keys.push("#" + id[1]);
    }
    if (classes) {
      for (const name of classes) {
        keys.push(name);
      }
    }
    if (tag) {
      keys.push(tag[1].toLowerCase());
    }
  }

  return keys.length > 0 ? keys : null;
}

const NO_KEYS = new Set();

// The keys of every ancestor element of `element`, in the form
// requiredAncestorKeys writes them. Kept per parent until a class or an id of
// it or above it changes, or it moves (flushStyleInvalidations).
function ancestorKeysOf(element) {
  const parent = element.parentElement;

  if (!parent) {
    return NO_KEYS;
  }

  const document = element._ownerDocument;
  const cache = document._ancestorKeyCache || (document._ancestorKeyCache = new WeakMap());
  let keys = cache.get(parent);

  if (!keys) {
    keys = new Set(ancestorKeysOf(parent));
    keys.add(asciiLowercase(parent._localName));

    const id = parent.getAttributeNS(null, "id");

    if (id) {
      keys.add("#" + id);
    }

    const className = parent.getAttributeNS(null, "class");

    if (className) {
      for (const name of className.split(/\s+/)) {
        if (name) {
          keys.add("." + name);
        }
      }
    }

    cache.set(parent, keys);
  }

  return keys;
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

// `localName` is the element's, ASCII lowercased, which is the form a type
// selector is keyed in. Passed in rather than taken from the element, because
// this runs once per candidate rule and the element's is the same every time.
function canPossiblyMatch(rule, element, localName) {
  const branches = rejectionKeysForRule(rule);

  // Unsupported selector shapes fall back to matching for real.
  if (branches === null) {
    return true;
  }

  for (const branch of branches) {
    if (branch.id && element.getAttributeNS(null, "id") !== branch.id) {
      continue;
    }
    if (branch.tag && localName !== branch.tag) {
      continue;
    }
    if (branch.classes) {
      const list = element.classList;
      if (branch.classes.some(name => !list.contains(name))) {
        continue;
      }
    }
    if (branch.ancestors) {
      const keys = ancestorKeysOf(element);
      if (branch.ancestors.some(key => !keys.has(key))) {
        continue;
      }
    }
    return true;
  }

  return false;
}

function matches(rule, element, localName) {
  if (!canPossiblyMatch(rule, element, localName)) {
    return false;
  }

  return matchesDontThrow(element, rule.selectorText);
}

// https://drafts.csswg.org/css-cascade-4/#cascading
//
// Origin, importance, specificity and document order are all sorted on; cascade
// layers are not, and @layer's contents are collected as though they were
// written where the layer is.
function getCascadedPropertyValue(element, property) {
  return exports.getDeclarationForElement(element).getPropertyValue(property);
}

// https://drafts.csswg.org/css-align/#gap-shorthand: one value is both gaps,
// two are the row gap and then the column gap. Split at top-level spaces only,
// since a function's arguments are not separate values.
function gapLonghandsOf(value) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const character of String(value || "").trim()) {
    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (/\s/.test(character) && depth === 0) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 1) {
    return [parts[0], parts[0]];
  }

  return parts.length === 2 ? parts : null;
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

  // The gap shorthand is not split into its longhands where its value holds a
  // function, so a longhand it set reads empty: taken for unset, it computed to
  // normal and outranked the shorthand for anyone reading both.
  if (property === "row-gap" || property === "column-gap") {
    const gap = gapLonghandsOf(getCascadedPropertyValue(element, "gap"));

    if (gap !== null) {
      return property === "row-gap" ? gap[0] : gap[1];
    }
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
