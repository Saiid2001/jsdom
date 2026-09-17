"use strict";

// Media query evaluation for the cascade.
//
// https://drafts.csswg.org/mediaqueries-4/
//
// The style system used to descend into a media rule only when its media list
// was literally "screen", which dropped every "@media (min-width: ...)" block.
// Responsive frameworks keep their desktop layout in exactly those blocks, so
// grids arrived unstyled and collapsed into a single full width column.
//
// Unknown features evaluate to false rather than throwing, which is what the
// spec asks for and keeps an unrecognised query from taking a sheet down.

// Absolute units, in CSS px. Relative units are resolved against the viewport,
// except for font relative ones: inside a media query "em" always means the
// initial font-size, never the document's.
const ABSOLUTE_UNITS = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16
};

const INITIAL_FONT_SIZE = 16;

function parseLength(text, viewport) {
  const match = /^(-?[\d.]+)([a-z%]*)$/i.exec(text.trim());

  if (!match) {
    return null;
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  if (!isFinite(value)) {
    return null;
  }

  if (unit === "" && value === 0) {
    return 0;
  }

  if (ABSOLUTE_UNITS[unit] !== undefined) {
    return value * ABSOLUTE_UNITS[unit];
  }

  switch (unit) {
    case "em":
    case "rem":
      return value * INITIAL_FONT_SIZE;
    case "vw":
      return (value / 100) * viewport.width;
    case "vh":
      return (value / 100) * viewport.height;
    case "vmin":
      return (value / 100) * Math.min(viewport.width, viewport.height);
    case "vmax":
      return (value / 100) * Math.max(viewport.width, viewport.height);
    default:
      return null;
  }
}

function parseResolution(text) {
  const match = /^([\d.]+)(dppx|dpi|dpcm|x)$/i.exec(text.trim());

  if (!match) {
    return null;
  }

  const value = parseFloat(match[1]);

  switch (match[2].toLowerCase()) {
    case "dppx":
    case "x":
      return value;
    case "dpi":
      return value / 96;
    case "dpcm":
      return value / (96 / 2.54);
    default:
      return null;
  }
}

function parseRatio(text) {
  const parts = text.split("/");

  if (parts.length === 2) {
    const numerator = parseFloat(parts[0]);
    const denominator = parseFloat(parts[1]);

    return denominator ? numerator / denominator : null;
  }

  const single = parseFloat(text);

  return isFinite(single) ? single : null;
}

// The value each feature is compared against, or undefined if the feature is
// not one this engine knows about.
function featureValue(name, viewport) {
  switch (name) {
    case "width":
    case "device-width":
      return viewport.width;
    case "height":
    case "device-height":
      return viewport.height;
    case "aspect-ratio":
    case "device-aspect-ratio":
      return viewport.height ? viewport.width / viewport.height : 0;
    case "resolution":
    case "device-pixel-ratio":
    case "-webkit-device-pixel-ratio":
    case "-moz-device-pixel-ratio":
      return viewport.pixelRatio;
    case "color":
      return 8;
    case "color-index":
      return 0;
    case "monochrome":
      return 0;
    case "grid":
      return 0;
    default:
      return undefined;
  }
}

// Features whose value is a keyword rather than a number.
const DISCRETE_FEATURES = {
  "orientation": viewport => (viewport.width >= viewport.height ? "landscape" : "portrait"),
  "prefers-color-scheme": () => "light",
  "prefers-reduced-motion": () => "no-preference",
  "prefers-reduced-transparency": () => "no-preference",
  "prefers-contrast": () => "no-preference",
  "forced-colors": () => "none",
  "inverted-colors": () => "none",
  "hover": () => "hover",
  "any-hover": () => "hover",
  "pointer": () => "fine",
  "any-pointer": () => "fine",
  "scripting": () => "enabled",
  "update": () => "fast",
  "overflow-block": () => "scroll",
  "overflow-inline": () => "scroll",
  "display-mode": () => "browser",
  "dynamic-range": () => "standard",
  "video-dynamic-range": () => "standard"
};

function compare(actual, operator, expected) {
  switch (operator) {
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    default:
      return actual === expected;
  }
}

// A value written for a numeric feature: a length, a resolution or a ratio,
// depending on which feature is being tested.
function parseFeatureOperand(name, text, viewport) {
  if (name === "resolution" || name.endsWith("device-pixel-ratio")) {
    const resolution = parseResolution(text);

    return resolution === null ? parseFloat(text) : resolution;
  }

  if (name.endsWith("aspect-ratio")) {
    return parseRatio(text);
  }

  const length = parseLength(text, viewport);

  return length === null ? parseFloat(text) : length;
}

// "(min-width: 768px)", "(width >= 768px)", "(400px < width <= 700px)",
// "(orientation: landscape)" or the boolean "(color)".
function evaluateFeature(text, viewport) {
  const body = text.trim();

  // Range syntax with two bounds, e.g. "400px <= width < 700px".
  const twoSided = /^(.+?)\s*(<=|>=|<|>)\s*([a-z-]+)\s*(<=|>=|<|>)\s*(.+)$/i.exec(body);

  if (twoSided) {
    const name = twoSided[3].toLowerCase();
    const value = featureValue(name, viewport);

    if (value === undefined) {
      return false;
    }

    // "a < width" is the same test as "width > a", so the left comparison is
    // read with its operator mirrored.
    const mirrored = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
    const low = parseFeatureOperand(name, twoSided[1], viewport);
    const high = parseFeatureOperand(name, twoSided[5], viewport);

    return compare(value, mirrored[twoSided[2]], low) &&
      compare(value, twoSided[4], high);
  }

  // Range syntax with one bound, either way round.
  const oneSided = /^(.+?)\s*(<=|>=|<|>|=)\s*(.+)$/.exec(body);

  if (oneSided) {
    const left = oneSided[1].trim().toLowerCase();
    const right = oneSided[3].trim();
    const leftIsFeature = featureValue(left, viewport) !== undefined ||
      DISCRETE_FEATURES[left] !== undefined;

    const name = leftIsFeature ? left : right.toLowerCase();
    const operandText = leftIsFeature ? right : oneSided[1];
    const mirrored = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };
    const operator = leftIsFeature ? oneSided[2] : mirrored[oneSided[2]];

    const discrete = DISCRETE_FEATURES[name];

    if (discrete) {
      return discrete(viewport) === operandText.trim().toLowerCase();
    }

    const value = featureValue(name, viewport);

    if (value === undefined) {
      return false;
    }

    const operand = parseFeatureOperand(name, operandText, viewport);

    return operand === null || !isFinite(operand)
      ? false
      : compare(value, operator, operand);
  }

  // Classic syntax: "min-width: 768px", "orientation: landscape", "color".
  const colon = body.indexOf(":");

  if (colon === -1) {
    const name = body.toLowerCase();
    const discrete = DISCRETE_FEATURES[name];

    if (discrete) {
      // A boolean context asks whether the feature is anything but "none"/zero.
      const current = discrete(viewport);
      return current !== "none" && current !== "no-preference";
    }

    const value = featureValue(name, viewport);

    return value === undefined ? false : value !== 0;
  }

  let name = body.slice(0, colon).trim().toLowerCase();
  const operandText = body.slice(colon + 1).trim();

  let operator = "=";

  // The min-/max- prefix sits after any vendor prefix, as in
  // "-webkit-min-device-pixel-ratio".
  const ranged = /^(-[a-z]+-)?(min|max)-(.+)$/.exec(name);

  if (ranged) {
    operator = ranged[2] === "min" ? ">=" : "<=";
    name = (ranged[1] || "") + ranged[3];
  }

  const discrete = DISCRETE_FEATURES[name];

  if (discrete) {
    return operator === "=" && discrete(viewport) === operandText.toLowerCase();
  }

  const value = featureValue(name, viewport);

  if (value === undefined) {
    return false;
  }

  const operand = parseFeatureOperand(name, operandText, viewport);

  if (operand === null || !isFinite(operand)) {
    return false;
  }

  return compare(value, operator, operand);
}

// Splits on a separator that appears outside parentheses.
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  const pattern = new RegExp(`^${separator}(?=\\s|\\(|$)`, "i");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
    }

    if (depth === 0 && /\s/.test(char)) {
      const rest = text.slice(i).trimStart();
      const match = pattern.exec(rest);

      if (match) {
        parts.push(current);
        const consumed = text.length - rest.length + match[0].length;
        current = "";
        i = consumed - 1;
        continue;
      }
    }

    current += char;
  }

  parts.push(current);

  return parts.map(part => part.trim()).filter(part => part !== "");
}

const MEDIA_TYPES = ["all", "screen", "print", "speech", "tty", "tv", "projection",
  "handheld", "braille", "embossed", "aural"];

// One query of a comma separated list: "only screen and (min-width: 768px)".
function evaluateQuery(query, viewport) {
  let text = query.trim().toLowerCase() === query.trim() ? query.trim() : query.trim();

  if (text === "") {
    return true;
  }

  let negated = false;

  // "only" exists to hide the query from parsers that predate media features
  // and has no effect on the result.
  const prefix = /^(only|not)\s+/i.exec(text);

  if (prefix) {
    negated = prefix[1].toLowerCase() === "not";
    text = text.slice(prefix[0].length);
  }

  const result = evaluateConjunction(text, viewport);

  return negated ? !result : result;
}

function evaluateConjunction(text, viewport) {
  // "or" binds looser than "and" in the modern syntax.
  const alternatives = splitTopLevel(text, "or");

  if (alternatives.length > 1) {
    return alternatives.some(part => evaluateConjunction(part, viewport));
  }

  const terms = splitTopLevel(text, "and");

  return terms.every(term => evaluateTerm(term, viewport));
}

function evaluateTerm(term, viewport) {
  const text = term.trim();

  if (text.startsWith("(") && text.endsWith(")")) {
    const inner = text.slice(1, -1).trim();

    // A parenthesised group may itself hold a boolean expression.
    if (/^(not\s|\()/i.test(inner) || splitTopLevel(inner, "and").length > 1 ||
      splitTopLevel(inner, "or").length > 1) {
      if (/^not\s/i.test(inner)) {
        return !evaluateConjunction(inner.slice(4), viewport);
      }
      return evaluateConjunction(inner, viewport);
    }

    return evaluateFeature(inner, viewport);
  }

  if (/^not\s/i.test(text)) {
    return !evaluateTerm(text.slice(4), viewport);
  }

  const type = text.toLowerCase();

  if (MEDIA_TYPES.includes(type)) {
    // This engine paints to a screen.
    return type === "all" || type === "screen";
  }

  // An unparenthesised feature is malformed, and a malformed query never
  // matches.
  return false;
}

/**
 * @param mediaList a CSSOM MediaList, or anything array like of query strings
 * @param viewport {width, height, pixelRatio}
 * @returns whether the rule's styles apply
 */
exports.matchesMediaList = (mediaList, viewport) => {
  const queries = [];

  for (let i = 0; i < mediaList.length; i++) {
    queries.push(mediaList[i]);
  }

  // An empty media list means "all".
  if (queries.length === 0) {
    return true;
  }

  return queries.some(query => {
    // A single entry can still hold a comma separated list depending on how the
    // sheet was parsed.
    return query.split(",").some(part => evaluateQuery(part, viewport));
  });
};

exports.viewportForWindow = window => ({
  width: typeof window?.innerWidth === "number" ? window.innerWidth : 1024,
  height: typeof window?.innerHeight === "number" ? window.innerHeight : 768,
  pixelRatio: typeof window?.devicePixelRatio === "number" ? window.devicePixelRatio : 1
});
