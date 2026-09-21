"use strict";
const cssom = require("rrweb-cssom");
const whatwgEncoding = require("whatwg-encoding");
const whatwgURL = require("whatwg-url");
const { invalidateStyleCache } = require("./style-rules");

// TODO: this should really implement https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet
// It (and the things it calls) is nowhere close right now.
exports.fetchStylesheet = (elementImpl, urlString) => {
  const parsedURL = whatwgURL.parseURL(urlString);
  return fetchStylesheetInternal(elementImpl, urlString, parsedURL);
};

// https://drafts.csswg.org/cssom/#remove-a-css-style-sheet
exports.removeStylesheet = (sheet, elementImpl) => {
  const { styleSheets } = elementImpl._ownerDocument;
  styleSheets._remove(sheet);

  // Remove the association explicitly; in the spec it's implicit so this step doesn't exist.
  elementImpl.sheet = null;

  invalidateStyleCache(elementImpl);

  // TODO: "Set the CSS style sheet’s parent CSS style sheet, owner node and owner CSS rule to null."
  // Probably when we have a real CSSOM implementation.
};

/**
 * Splits a sheet into the constructs at its top level, so that one of them
 * failing to parse does not take the rest with it. Strings and comments are
 * skipped over, since a brace inside either is not a brace.
 */
function splitTopLevelConstructs(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quote) {
      if (char === "\\") {
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth <= 0) {
        depth = 0;
        parts.push(text.slice(start, i + 1));
        start = i + 1;
      }
    } else if (char === ";" && depth === 0) {
      parts.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }

  if (start < text.length) {
    parts.push(text.slice(start));
  }

  return parts.map(part => part.trim()).filter(Boolean);
}

/**
 * Parses a sheet, and if the parser rejects it, again construct by construct so
 * that only the construct it cannot read is lost.
 *
 * CSS is defined to skip what it cannot parse and carry on. This parser instead
 * throws for the whole sheet, and one unreadable rule — an at-rule nested in
 * another at-rule is enough — discarded every other rule alongside it. A single
 * "@font-feature-values" cost one page its entire 25kB of styles, custom
 * properties and all.
 */
function parseWithRecovery(sheetText) {
  try {
    return cssom.parse(sheetText);
  } catch {
    // Fall through to parsing the constructs separately.
  }

  const sheet = cssom.parse("");

  for (const part of splitTopLevelConstructs(sheetText)) {
    try {
      const parsed = cssom.parse(part);

      for (const rule of parsed.cssRules) {
        rule.parentStyleSheet = sheet;
        sheet.cssRules.push(rule);
      }
    } catch {
      // This construct alone is unreadable; the rest of the sheet is not.
    }
  }

  return sheet.cssRules.length > 0 ? sheet : null;
}

// https://drafts.csswg.org/cssom/#create-a-css-style-sheet kinda:
// - The import rules stuff seems out of place, and probably should affect the load event...
exports.createStylesheet = (sheetText, elementImpl, baseURL) => {
  let sheet;
  try {
    sheet = parseWithRecovery(sheetText);
  } catch {
    sheet = null;
  }

  if (!sheet) {
    if (elementImpl._ownerDocument._defaultView) {
      const error = new Error("Could not parse CSS stylesheet");
      error.detail = sheetText;
      error.type = "css parsing";

      elementImpl._ownerDocument._defaultView._virtualConsole.emit("jsdomError", error);
    }
    return;
  }

  scanForImportRules(elementImpl, sheet.cssRules, baseURL);

  addStylesheet(sheet, elementImpl);
};

/**
 * Installs a sheet that was reached through an @import. It joins the
 * document's sheets so the cascade sees its rules, and the element keeps the
 * sheet that imported it.
 *
 * CSSOM nests an imported sheet inside the rule that imported it and reads it
 * from there; this puts it alongside instead. The difference is in the order:
 * an @import comes before the rules of the sheet holding it, so its rules
 * should lose a tie against them, and here they win one.
 */
exports.createImportedStylesheet = (sheetText, elementImpl, baseURL) => {
  let sheet;

  try {
    sheet = parseWithRecovery(sheetText);
  } catch {
    sheet = null;
  }

  if (!sheet) {
    return;
  }

  scanForImportRules(elementImpl, sheet.cssRules, baseURL);

  elementImpl._ownerDocument.styleSheets._add(sheet);
  invalidateStyleCache(elementImpl);
};

// https://drafts.csswg.org/cssom/#add-a-css-style-sheet
function addStylesheet(sheet, elementImpl) {
  elementImpl._ownerDocument.styleSheets._add(sheet);

  // Set the association explicitly; in the spec it's implicit.
  elementImpl.sheet = sheet;

  invalidateStyleCache(elementImpl);

  // TODO: title and disabled stuff
}

function fetchStylesheetInternal(elementImpl, urlString, parsedURL, imported = false) {
  const document = elementImpl._ownerDocument;
  let defaultEncoding = document._encoding;
  const resourceLoader = document._resourceLoader;

  if (elementImpl.localName === "link" && elementImpl.hasAttributeNS(null, "charset")) {
    defaultEncoding = whatwgEncoding.labelToName(elementImpl.getAttributeNS(null, "charset"));
  }

  function onStylesheetLoad(data) {
    // if the element was detached before the load could finish, don't process the data
    if (!elementImpl._attached) {
      return;
    }

    const css = whatwgEncoding.decode(data, defaultEncoding);

    // TODO: MIME type checking?

    // A sheet reached through an @import belongs to the sheet that imported
    // it, not to the element that pulled that one in. Installed here it took
    // the element's sheet, and the sheet holding the @import was removed to
    // make room for it: a stylesheet whose first line is an @import kept the
    // rules of whatever it imported and lost every one of its own. vuejs.org
    // imports its fonts that way and was left with 14 rules of the 1,214 it
    // has, so almost none of the page was styled.
    if (imported) {
      exports.createImportedStylesheet(css, elementImpl, parsedURL);

      return;
    }

    if (elementImpl.sheet) {
      exports.removeStylesheet(elementImpl.sheet, elementImpl);
    }
    exports.createStylesheet(css, elementImpl, parsedURL);
  }

  resourceLoader.fetch(urlString, {
    element: elementImpl,
    onLoad: onStylesheetLoad
  });
}

// TODO this is actually really messed up and overwrites the sheet on elementImpl
// Tracking in https://github.com/jsdom/jsdom/issues/2124
function scanForImportRules(elementImpl, cssRules, baseURL) {
  if (!cssRules) {
    return;
  }

  for (let i = 0; i < cssRules.length; ++i) {
    if (cssRules[i].cssRules) {
      // @media rule: keep searching inside it.
      scanForImportRules(elementImpl, cssRules[i].cssRules, baseURL);
    } else if (cssRules[i].href) {
      // @import rule: fetch the resource and evaluate it.
      // See http://dev.w3.org/csswg/cssom/#css-import-rule
      //     If loading of the style sheet fails its cssRules list is simply
      //     empty. I.e. an @import rule always has an associated style sheet.
      const parsed = whatwgURL.parseURL(cssRules[i].href, { baseURL });
      if (parsed === null) {
        const window = elementImpl._ownerDocument._defaultView;
        if (window) {
          const error = new Error(`Could not parse CSS @import URL ${cssRules[i].href} relative to base URL ` +
                                  `"${whatwgURL.serializeURL(baseURL)}"`);
          error.type = "css @import URL parsing";
          window._virtualConsole.emit("jsdomError", error);
        }
      } else {
        fetchStylesheetInternal(elementImpl, whatwgURL.serializeURL(parsed), parsed, true);
      }
    }
  }
}
