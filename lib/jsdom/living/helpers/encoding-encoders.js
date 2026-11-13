"use strict";
const iconvLite = require("iconv-lite");

// The Encoding Standard's encoders, for the two places the web still encodes
// text in a legacy encoding: a URL's query and a submitted form.
// https://encoding.spec.whatwg.org/#encoders-and-decoders
//
// The indexes are not shipped. Each is read back out of a decoder, which holds
// the same tables: decoding the bytes a pointer names gives the pointer's code
// point. An index is built the first time its encoding is asked for.

const UTF_8 = "UTF-8";

// https://encoding.spec.whatwg.org/#get-an-output-encoding
function outputEncoding(name) {
  return name === "replacement" || name === "UTF-16BE" || name === "UTF-16LE" ? UTF_8 : name;
}
exports.outputEncoding = outputEncoding;

// The platform's decoder for `label`, or else iconv-lite's, which is
// whatwg-encoding's and so the one documents are decoded with, but which
// predates GB18030-2022. A browser's TextDecoder implements the standard.
function platformDecode(label, bytes) {
  let decoder = null;
  try {
    decoder = typeof TextDecoder === "function" ? new TextDecoder(label) : null;
  } catch {
    // Not an encoding this TextDecoder has.
  }
  if (decoder !== null) {
    return decoder.decode(bytes);
  }
  return iconvLite.decode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), label);
}

// Decodes each byte sequence of `sequences` separately, in one call: each is
// followed by a line feed, which no sequence here can swallow, so a sequence
// that is an error cannot run into the next one. Returns, per sequence, its
// code point, or null where it decodes to anything but one code point.
function decodeEach(label, sequences) {
  const width = sequences.reduce((sum, bytes) => sum + bytes.length + 1, 0);
  const buffer = new Uint8Array(width);
  let at = 0;
  for (const bytes of sequences) {
    buffer.set(bytes, at);
    at += bytes.length;
    buffer[at++] = 0x0A;
  }

  const pieces = platformDecode(label, buffer).split("\n");
  return sequences.map((_, i) => {
    const piece = pieces[i];
    if (piece === undefined) {
      return null;
    }
    const codePoint = piece.codePointAt(0);
    if (codePoint === undefined || codePoint === 0xFFFD ||
        piece.length !== (codePoint > 0xFFFF ? 2 : 1)) {
      return null;
    }
    return codePoint;
  });
}

// Code point -> pointer, from pointer -> bytes. `pick` decides between two
// pointers for one code point; the first wins unless it says otherwise.
function inverseIndex(label, pointers, bytesOf, pick = () => false) {
  const codePoints = decodeEach(label, pointers.map(bytesOf));
  const index = new Map();
  pointers.forEach((pointer, i) => {
    const codePoint = codePoints[i];
    if (codePoint !== null && (!index.has(codePoint) || pick(codePoint))) {
      index.set(codePoint, pointer);
    }
  });
  return index;
}

function range(from, to) {
  const pointers = [];
  for (let pointer = from; pointer < to; ++pointer) {
    pointers.push(pointer);
  }
  return pointers;
}

const indexes = new Map();
function cached(key, build) {
  if (!indexes.has(key)) {
    indexes.set(key, build());
  }
  return indexes.get(key);
}

// index jis0208. EUC-JP reaches pointers 0 to 8835; the IBM extensions past
// them (10716 and up) only Shift_JIS reaches, and it decodes the pointers
// between as the Private Use Area rather than through the index. The Shift_JIS
// index pointer excludes 8272 to 8835, which repeat the IBM extensions.
function jis0208() {
  return cached("jis0208", () => {
    const index = new Map();
    const low = inverseIndex(
      "euc-jp",
      range(0, 94 * 94),
      p => [Math.floor(p / 94) + 0xA1, (p % 94) + 0xA1]
    );
    const high = inverseIndex("shift_jis", range(10716, 11280), p => {
      const lead = Math.floor(p / 188);
      const trail = p % 188;
      return [lead + (lead < 0x1F ? 0x81 : 0xC1), trail + (trail < 0x3F ? 0x40 : 0x41)];
    });
    for (const [codePoint, pointer] of low) {
      index.set(codePoint, pointer);
    }
    for (const [codePoint, pointer] of high) {
      if (!index.has(codePoint)) {
        index.set(codePoint, pointer);
      }
    }
    return index;
  });
}

// https://encoding.spec.whatwg.org/#index-shift_jis-pointer
function shiftJISIndex() {
  return cached("shift_jis", () => {
    const pointers = range(0, 11280).filter(p => p < 8272 || p >= 10716);
    return inverseIndex("shift_jis", pointers, p => {
      const lead = Math.floor(p / 188);
      const trail = p % 188;
      return [lead + (lead < 0x1F ? 0x81 : 0xC1), trail + (trail < 0x3F ? 0x40 : 0x41)];
    });
  });
}

// https://encoding.spec.whatwg.org/#index-big5-pointer
const BIG5_PREFERS_LAST = new Set([0x2550, 0x255E, 0x2561, 0x256A, 0x5341, 0x5345]);
function big5Index() {
  return cached("big5", () => {
    return inverseIndex("big5", range((0xA1 - 0x81) * 157, (0xFE - 0x81 + 1) * 157), p => {
      const trail = p % 157;
      return [Math.floor(p / 157) + 0x81, trail + (trail < 0x3F ? 0x40 : 0x62)];
    }, codePoint => BIG5_PREFERS_LAST.has(codePoint));
  });
}

function eucKRIndex() {
  return cached("euc-kr", () => {
    return inverseIndex(
      "euc-kr",
      range(0, (0xFE - 0x81 + 1) * 190),
      p => [Math.floor(p / 190) + 0x81, (p % 190) + 0x41]
    );
  });
}

function gb18030Index() {
  return cached("gb18030", () => {
    return inverseIndex("gb18030", range(0, (0xFE - 0x81 + 1) * 190), p => {
      const trail = p % 190;
      return [Math.floor(p / 190) + 0x81, trail + (trail < 0x3F ? 0x40 : 0x41)];
    });
  });
}

// index gb18030 ranges, inverted over the Basic Multilingual Plane, whose
// four-byte pointers run from 0 to 39419. Above it the mapping is linear.
function gb18030RangesIndex() {
  return cached("gb18030 ranges", () => {
    return inverseIndex("gb18030", range(0, 39420), p => {
      const b1 = Math.floor(p / 12600);
      const b2 = Math.floor((p % 12600) / 1260);
      const b3 = Math.floor((p % 1260) / 10);
      return [b1 + 0x81, b2 + 0x30, b3 + 0x81, (p % 10) + 0x30];
    });
  });
}

// https://encoding.spec.whatwg.org/#gb18030-encoder, step 4.
const GB18030_PUA = new Map([
  [0xE78D, [0xA6, 0xD9]], [0xE78E, [0xA6, 0xDA]], [0xE78F, [0xA6, 0xDB]], [0xE790, [0xA6, 0xDC]],
  [0xE791, [0xA6, 0xDD]], [0xE792, [0xA6, 0xDE]], [0xE793, [0xA6, 0xDF]], [0xE794, [0xA6, 0xEC]],
  [0xE795, [0xA6, 0xED]], [0xE796, [0xA6, 0xF3]], [0xE81E, [0xFE, 0x59]], [0xE826, [0xFE, 0x61]],
  [0xE82B, [0xFE, 0x66]], [0xE82C, [0xFE, 0x67]], [0xE832, [0xFE, 0x6D]], [0xE843, [0xFE, 0x7E]],
  [0xE854, [0xFE, 0x90]], [0xE864, [0xFE, 0xA0]]
]);

// index ISO-2022-JP katakana
const ISO2022JP_KATAKANA = [
  0x3002, 0x300C, 0x300D, 0x3001, 0x30FB, 0x30F2, 0x30A1, 0x30A3, 0x30A5, 0x30A7, 0x30A9, 0x30E3,
  0x30E5, 0x30E7, 0x30C3, 0x30FC, 0x30A2, 0x30A4, 0x30A6, 0x30A8, 0x30AA, 0x30AB, 0x30AD, 0x30AF,
  0x30B1, 0x30B3, 0x30B5, 0x30B7, 0x30B9, 0x30BB, 0x30BD, 0x30BF, 0x30C1, 0x30C4, 0x30C6, 0x30C8,
  0x30CA, 0x30CB, 0x30CC, 0x30CD, 0x30CE, 0x30CF, 0x30D2, 0x30D5, 0x30D8, 0x30DB, 0x30DE, 0x30DF,
  0x30E0, 0x30E1, 0x30E2, 0x30E4, 0x30E6, 0x30E8, 0x30E9, 0x30EA, 0x30EB, 0x30EC, 0x30ED, 0x30EF,
  0x30F3, 0x309B, 0x309C
];

function isASCII(c) {
  return c < 0x80;
}

// An encoder is a function from one code point to an array of bytes, or null
// for an error with that code point, or { error } for an error with another.
// ISO-2022-JP's is stateful: it may emit an escape sequence and ask for the
// same code point again by returning { bytes, again: true }, and its `end`
// returns it to ASCII at the end of the input.
function singleByteEncoder(name) {
  const index = cached(name, () => {
    return inverseIndex(name, range(0, 128), p => [p + 0x80]);
  });
  return c => {
    if (isASCII(c)) {
      return [c];
    }
    const pointer = index.get(c);
    return pointer === undefined ? null : [pointer + 0x80];
  };
}

const encoders = {
  "x-user-defined": () => c => {
    if (isASCII(c)) {
      return [c];
    }
    return c >= 0xF780 && c <= 0xF7FF ? [c - 0xF780 + 0x80] : null;
  },

  "GBK": () => gb18030Encoder(true),
  "gb18030": () => gb18030Encoder(false),

  "Big5": () => {
    const index = big5Index();
    return c => {
      if (isASCII(c)) {
        return [c];
      }
      const pointer = index.get(c);
      if (pointer === undefined) {
        return null;
      }
      const trail = pointer % 157;
      return [Math.floor(pointer / 157) + 0x81, trail + (trail < 0x3F ? 0x40 : 0x62)];
    };
  },

  "EUC-JP": () => {
    const index = jis0208();
    return c => {
      if (isASCII(c)) {
        return [c];
      }
      if (c === 0xA5) {
        return [0x5C];
      }
      if (c === 0x203E) {
        return [0x7E];
      }
      if (c >= 0xFF61 && c <= 0xFF9F) {
        return [0x8E, c - 0xFF61 + 0xA1];
      }
      const pointer = index.get(c === 0x2212 ? 0xFF0D : c);
      if (pointer === undefined || pointer >= 94 * 94) {
        return null;
      }
      return [Math.floor(pointer / 94) + 0xA1, (pointer % 94) + 0xA1];
    };
  },

  "ISO-2022-JP": () => {
    const index = jis0208();
    let state = "ASCII";
    function encoder(c) {
      if ((state === "ASCII" || state === "Roman") && (c === 0x0E || c === 0x0F || c === 0x1B)) {
        return { error: 0xFFFD };
      }
      if (state === "ASCII" && isASCII(c)) {
        return [c];
      }
      if (state === "Roman" && ((isASCII(c) && c !== 0x5C && c !== 0x7E) || c === 0xA5 || c === 0x203E)) {
        if (c === 0xA5) {
          return [0x5C];
        }
        return c === 0x203E ? [0x7E] : [c];
      }
      if (isASCII(c)) {
        state = "ASCII";
        return { bytes: [0x1B, 0x28, 0x42], again: true };
      }
      if (c === 0xA5 || c === 0x203E) {
        state = "Roman";
        return { bytes: [0x1B, 0x28, 0x4A], again: true };
      }
      let target = c === 0x2212 ? 0xFF0D : c;
      if (target >= 0xFF61 && target <= 0xFF9F) {
        target = ISO2022JP_KATAKANA[target - 0xFF61];
      }
      const pointer = index.get(target);
      if (pointer === undefined || pointer >= 94 * 94) {
        if (state === "jis0208") {
          state = "ASCII";
          return { bytes: [0x1B, 0x28, 0x42], again: true };
        }
        return null;
      }
      if (state !== "jis0208") {
        state = "jis0208";
        return { bytes: [0x1B, 0x24, 0x42], again: true };
      }
      return [Math.floor(pointer / 94) + 0x21, (pointer % 94) + 0x21];
    }
    encoder.end = () => {
      if (state === "ASCII") {
        return [];
      }
      state = "ASCII";
      return [0x1B, 0x28, 0x42];
    };
    return encoder;
  },

  "Shift_JIS": () => {
    const index = shiftJISIndex();
    return c => {
      if (isASCII(c) || c === 0x80) {
        return [c];
      }
      if (c === 0xA5) {
        return [0x5C];
      }
      if (c === 0x203E) {
        return [0x7E];
      }
      if (c >= 0xFF61 && c <= 0xFF9F) {
        return [c - 0xFF61 + 0xA1];
      }
      const pointer = index.get(c === 0x2212 ? 0xFF0D : c);
      if (pointer === undefined) {
        return null;
      }
      const lead = Math.floor(pointer / 188);
      const trail = pointer % 188;
      return [lead + (lead < 0x1F ? 0x81 : 0xC1), trail + (trail < 0x3F ? 0x40 : 0x41)];
    };
  },

  "EUC-KR": () => {
    const index = eucKRIndex();
    return c => {
      if (isASCII(c)) {
        return [c];
      }
      const pointer = index.get(c);
      if (pointer === undefined) {
        return null;
      }
      return [Math.floor(pointer / 190) + 0x81, (pointer % 190) + 0x41];
    };
  }
};

function gb18030Encoder(isGBK) {
  const index = gb18030Index();
  return c => {
    if (isASCII(c)) {
      return [c];
    }
    if (c === 0xE5E5) {
      return null;
    }
    if (isGBK && c === 0x20AC) {
      return [0x80];
    }
    if (GB18030_PUA.has(c)) {
      return GB18030_PUA.get(c);
    }
    const pointer = index.get(c);
    if (pointer !== undefined) {
      const trail = pointer % 190;
      return [Math.floor(pointer / 190) + 0x81, trail + (trail < 0x3F ? 0x40 : 0x41)];
    }
    if (isGBK) {
      return null;
    }
    let rangesPointer;
    if (c > 0xFFFF) {
      rangesPointer = 189000 + c - 0x10000;
    } else {
      rangesPointer = gb18030RangesIndex().get(c);
      if (rangesPointer === undefined) {
        return null;
      }
    }
    const b1 = Math.floor(rangesPointer / 12600);
    const b2 = Math.floor((rangesPointer % 12600) / 1260);
    const b3 = Math.floor((rangesPointer % 1260) / 10);
    return [b1 + 0x81, b2 + 0x30, b3 + 0x81, (rangesPointer % 10) + 0x30];
  };
}

const SINGLE_BYTE = new Set([
  "IBM866", "ISO-8859-2", "ISO-8859-3", "ISO-8859-4", "ISO-8859-5", "ISO-8859-6", "ISO-8859-7",
  "ISO-8859-8", "ISO-8859-8-I", "ISO-8859-10", "ISO-8859-13", "ISO-8859-14", "ISO-8859-15",
  "ISO-8859-16", "KOI8-R", "KOI8-U", "macintosh", "windows-874", "windows-1250", "windows-1251",
  "windows-1252", "windows-1253", "windows-1254", "windows-1255", "windows-1256", "windows-1257",
  "windows-1258", "x-mac-cyrillic"
]);

// A new encoder for `name`, an encoding's name, or null where it is UTF-8 or
// no decoder can supply its index.
function getEncoder(name) {
  const make = SINGLE_BYTE.has(name) ? () => singleByteEncoder(name) : encoders[name];
  if (!make) {
    return null;
  }
  try {
    return make();
  } catch {
    return null;
  }
}

function* scalarValues(string) {
  for (const character of string) {
    const codePoint = character.codePointAt(0);
    yield codePoint >= 0xD800 && codePoint <= 0xDFFF ? 0xFFFD : codePoint;
  }
}


function hex(byte) {
  return `%${byte < 0x10 ? "0" : ""}${byte.toString(16).toUpperCase()}`;
}

/**
 * https://url.spec.whatwg.org/#string-percent-encode-after-encoding
 *
 * `inSet(byte)` says whether the byte's isomorphic code point is in the
 * percent-encode set. `encoding` is an encoding's name.
 */
exports.percentEncodeAfterEncoding = (encoding, input, inSet, spaceAsPlus = false) => {
  const encoder = getEncoder(outputEncoding(encoding));
  let output = "";
  function append(bytes) {
    for (const byte of bytes) {
      if (spaceAsPlus && byte === 0x20) {
        output += "+";
      } else if (inSet(byte)) {
        output += hex(byte);
      } else {
        output += String.fromCharCode(byte);
      }
    }
  }

  if (!encoder) {
    // A lone surrogate is written as U+FFFD's bytes.
    append(Buffer.from(input, "utf8"));
    return output;
  }

  for (const codePoint of scalarValues(input)) {
    for (;;) {
      const result = encoder(codePoint);
      if (result === null || result.error !== undefined) {
        const value = result === null ? codePoint : result.error;
        output += `%26%23${value}%3B`;
        break;
      }
      if (Array.isArray(result)) {
        append(result);
        break;
      }
      append(result.bytes);
      if (!result.again) {
        break;
      }
    }
  }
  if (encoder.end) {
    append(encoder.end());
  }
  return output;
};
