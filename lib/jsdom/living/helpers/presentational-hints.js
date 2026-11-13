"use strict";
const { HTML_NS } = require("./namespaces");
const { asciiLowercase } = require("./strings");

// Presentational hints: the attributes HTML maps to CSS properties, applied as
// author declarations ranked below every author rule. Only the table and body
// attributes a page lays itself out with are here -- the dimensions, colours
// and alignments a table layout sizes and places its columns by.
// https://html.spec.whatwg.org/multipage/rendering.html#presentational-hints

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-dimension-values
function dimension(value) {
  const match = /^[\t\n\f\r ]*(\d+(?:\.\d+)?)(%?)/.exec(value);

  if (!match) {
    return null;
  }

  return match[2] ? `${match[1]}%` : `${match[1]}px`;
}

// "Maps to the dimension property (ignoring zero)".
function nonZeroDimension(value) {
  const parsed = dimension(value);

  return parsed !== null && parseFloat(parsed) > 0 ? parsed : null;
}

// The legacy colour forms: a keyword or a hash colour as CSS writes them, and
// six or three hex digits written without the hash. The rest of HTML's legacy
// algorithm, which salvages a colour out of arbitrary text, is not done.
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-legacy-colour-value
function legacyColor(value) {
  const trimmed = value.trim();

  if (trimmed === "" || asciiLowercase(trimmed) === "transparent") {
    return null;
  }

  if (/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    return `#${trimmed}`;
  }

  return trimmed;
}

const CELL_ALIGN = { left: "left", right: "right", center: "center", middle: "center", justify: "justify" };
const VALIGN = { top: "top", middle: "middle", bottom: "bottom", baseline: "baseline" };

const BGCOLOR = new Set(["body", "table", "thead", "tbody", "tfoot", "tr", "td", "th"]);

// [property, value] pairs, in no particular order: no two set the same property.
exports.presentationalHints = elementImpl => {
  if (elementImpl._namespaceURI !== HTML_NS) {
    return [];
  }

  const name = elementImpl._localName;
  const attr = attribute => elementImpl.getAttributeNS(null, attribute);
  const hints = [];
  const add = (property, value) => {
    if (value !== null && value !== undefined) {
      hints.push([property, value]);
    }
  };

  if (BGCOLOR.has(name) && attr("bgcolor") !== null) {
    add("background-color", legacyColor(attr("bgcolor")));
  }

  switch (name) {
    case "table": {
      if (attr("width") !== null) {
        add("width", nonZeroDimension(attr("width")));
      }

      if (attr("height") !== null) {
        add("height", dimension(attr("height")));
      }

      const align = asciiLowercase(attr("align") ?? "");

      if (align === "center") {
        add("margin-left", "auto");
        add("margin-right", "auto");
      } else if (align === "left" || align === "right") {
        add("float", align);
      }
      break;
    }
    case "td":
    case "th":
      if (attr("width") !== null) {
        add("width", nonZeroDimension(attr("width")));
      }

      if (attr("height") !== null) {
        add("height", nonZeroDimension(attr("height")));
      }
    // falls through
    case "tr":
      if (name === "tr" && attr("height") !== null) {
        add("height", dimension(attr("height")));
      }

      add("text-align", CELL_ALIGN[asciiLowercase(attr("align") ?? "")]);
    // falls through
    case "thead":
    case "tbody":
    case "tfoot":
      add("vertical-align", VALIGN[asciiLowercase(attr("valign") ?? "")]);
      break;
    case "col":
    case "colgroup":
      if (attr("width") !== null) {
        add("width", nonZeroDimension(attr("width")));
      }
      break;
  }

  return hints;
};
