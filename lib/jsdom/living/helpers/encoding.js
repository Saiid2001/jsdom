"use strict";
const whatwgEncoding = require("whatwg-encoding");
const sniffHTMLEncoding = require("html-encoding-sniffer");

// whatwg-encoding decodes through iconv-lite, and knows no label for the
// encodings iconv-lite lacks. Those the platform's TextDecoder has are
// decoded with it instead, so a document in one of them is not read as
// windows-1252.
// https://encoding.spec.whatwg.org/#names-and-labels

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
  const name = whatwgEncoding.labelToName(label);
  if (name !== null) {
    return name;
  }
  const extra = EXTRA_LABELS.get(String(label).trim().toLowerCase());
  return extra !== undefined && decoderFor(extra) !== null ? extra : null;
};

exports.isSupported = name => whatwgEncoding.isSupported(name) ||
  ([...EXTRA_LABELS.values()].includes(name) && decoderFor(name) !== null);

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

/** https://html.spec.whatwg.org/multipage/parsing.html#encoding-sniffing-algorithm */
exports.sniffHTMLEncoding = (bytes, { transportLayerEncodingLabel, defaultEncoding }) => {
  if (whatwgEncoding.getBOMEncoding(bytes) === null && transportLayerEncodingLabel !== undefined) {
    const name = exports.labelToName(transportLayerEncodingLabel);
    if (name !== null) {
      return name;
    }
  }
  return sniffHTMLEncoding(bytes, { defaultEncoding });
};
