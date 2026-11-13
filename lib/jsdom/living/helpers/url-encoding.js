"use strict";
const whatwgURL = require("whatwg-url");
const { outputEncoding, percentEncodeAfterEncoding } = require("./encoding-encoders");

// whatwg-url takes an encoding override and ignores it: its query state
// always encodes UTF-8. This parses with it and then sets the query the way
// the query state does with the encoding.
// https://url.spec.whatwg.org/#query-state

const SPECIAL_SCHEMES = new Set(["ftp", "file", "http", "https", "ws", "wss"]);

// https://url.spec.whatwg.org/#special-query-percent-encode-set
function inSpecialQuerySet(byte) {
  return byte < 0x21 || byte > 0x7E ||
    byte === 0x22 || byte === 0x23 || byte === 0x3C || byte === 0x3E || byte === 0x27;
}

// The input as the basic URL parser reads it: leading and trailing C0 controls
// and spaces removed, then every ASCII tab or newline.
function cleaned(input) {
  return input.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/gu, "").replace(/[\t\n\r]/gu, "");
}

/**
 * The query an input string gives a special URL, before percent-encoding, or
 * null where the input has none and the URL took its base's.
 *
 * In a special URL nothing before the query can hold a "?": the scheme cannot,
 * and the authority, host and path states each end at one. So the query is
 * whatever follows the first "?" up to a "#", if no "#" came first.
 */
function rawQuery(input) {
  const string = cleaned(input);
  const question = string.indexOf("?");
  const hash = string.indexOf("#");
  if (question === -1 || (hash !== -1 && hash < question)) {
    return null;
  }
  return string.slice(question + 1, hash === -1 ? undefined : hash);
}

/** whatwgURL.parseURL with the encoding the query is encoded in. */
exports.parseURLWithEncoding = (input, baseURL, encoding) => {
  const url = whatwgURL.parseURL(input, { baseURL });
  if (url === null || url.query === null || !encoding || outputEncoding(encoding) === "UTF-8" ||
      !SPECIAL_SCHEMES.has(url.scheme) || url.scheme === "ws" || url.scheme === "wss") {
    return url;
  }

  const query = rawQuery(String(input));
  if (query !== null) {
    url.query = percentEncodeAfterEncoding(encoding, query, inSpecialQuerySet);
  }
  return url;
};
