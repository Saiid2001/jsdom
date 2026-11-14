"use strict";
const whatwgEncoding = require("whatwg-encoding");
const sniffHTMLEncoding = require("html-encoding-sniffer");

// whatwg-encoding's interface (labelToName, isSupported, decode,
// getBOMEncoding), which the fork's decoding sites use in its place.
//
// whatwg-encoding decodes through iconv-lite, and knows no label for the
// encodings iconv-lite lacks. Those the platform's TextDecoder has are
// decoded with it instead, so a document in one of them is not read as
// windows-1252.
// https://encoding.spec.whatwg.org/#names-and-labels

// whatwg-encoding's own, kept before sniffHTMLEncoding swaps it out below.
const baseLabelToName = whatwgEncoding.labelToName;

const EXTRA_LABELS = new Map([
  ["csiso2022jp", "ISO-2022-JP"],
  ["iso-2022-jp", "ISO-2022-JP"],
  ["csiso88598i", "ISO-8859-8-I"],
  ["iso-8859-8-i", "ISO-8859-8-I"],
  ["logical", "ISO-8859-8-I"],
  ["x-mac-cyrillic", "x-mac-cyrillic"],
  ["x-mac-ukrainian", "x-mac-cyrillic"]
]);

function decoderFor(name) {
  if (typeof TextDecoder !== "function") {
    return null;
  }
  try {
    return new TextDecoder(name);
  } catch {
    return null;
  }
}

/** https://encoding.spec.whatwg.org/#concept-encoding-get, for the encodings that can be decoded. */
exports.labelToName = label => {
  const name = baseLabelToName(label);
  if (name !== null) {
    return name;
  }
  const extra = EXTRA_LABELS.get(String(label).trim().toLowerCase());
  return extra !== undefined && decoderFor(extra) !== null ? extra : null;
};

exports.isSupported = name => whatwgEncoding.isSupported(name) ||
  ([...EXTRA_LABELS.values()].includes(name) && decoderFor(name) !== null);

exports.getBOMEncoding = whatwgEncoding.getBOMEncoding;

/** https://encoding.spec.whatwg.org/#decode */
exports.decode = (bytes, name) => {
  if (whatwgEncoding.isSupported(name) || whatwgEncoding.getBOMEncoding(bytes) !== null) {
    return whatwgEncoding.decode(bytes, whatwgEncoding.isSupported(name) ? name : "UTF-8");
  }
  const decoder = decoderFor(name);
  if (decoder === null) {
    throw new RangeError(`"${name}" is not a supported encoding name`);
  }
  return decoder.decode(bytes);
};

/**
 * https://html.spec.whatwg.org/multipage/parsing.html#encoding-sniffing-algorithm
 *
 * html-encoding-sniffer resolves both the transport layer label and a <meta>
 * charset through whatwg-encoding's labelToName, read off the module at each
 * call. It is given this module's for the length of the (synchronous) call.
 */
exports.sniffHTMLEncoding = (bytes, options) => {
  whatwgEncoding.labelToName = exports.labelToName;
  try {
    return sniffHTMLEncoding(bytes, options);
  } finally {
    whatwgEncoding.labelToName = baseLabelToName;
  }
};

// 40 63 68 61 72 73 65 74 20 22: `@charset "`, byte for byte.
const CHARSET_RULE_START = [0x40, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x20, 0x22];

/**
 * https://drafts.csswg.org/css-syntax/#determine-the-fallback-encoding
 *
 * The encoding a style sheet's bytes are decoded with when they carry no BOM
 * (decode() lets a BOM override it): the protocol's label, else an @charset
 * rule opening the first 1024 bytes, else the environment encoding (the
 * encoding of the document that links it), else UTF-8.
 */
exports.cssFallbackEncoding = (bytes, { protocolLabel = null, environmentEncoding = null } = {}) => {
  if (protocolLabel !== null && protocolLabel !== undefined) {
    const encoding = exports.labelToName(protocolLabel);
    if (encoding !== null) {
      return encoding;
    }
  }

  const limit = Math.min(bytes.length, 1024);
  if (limit > CHARSET_RULE_START.length && CHARSET_RULE_START.every((byte, i) => bytes[i] === byte)) {
    let end = CHARSET_RULE_START.length;
    while (end < limit && bytes[end] !== 0x22 && bytes[end] !== 0x3B) {
      end++;
    }
    if (end + 1 < limit && bytes[end] === 0x22 && bytes[end + 1] === 0x3B) {
      const label = String.fromCharCode(...bytes.subarray(CHARSET_RULE_START.length, end));
      const encoding = exports.labelToName(label);
      if (encoding === "UTF-16BE" || encoding === "UTF-16LE") {
        return "UTF-8";
      }
      if (encoding !== null) {
        return encoding;
      }
    }
  }

  return environmentEncoding || "UTF-8";
};
