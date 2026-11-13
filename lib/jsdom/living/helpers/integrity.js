"use strict";
const crypto = require("crypto");

// Subresource Integrity (https://w3c.github.io/webappsec-subresource-integrity/).
//
// A digest is computed with Node's createHash, which a bundle for the browser
// carries as a JavaScript implementation: verifying a resource makes no call
// the host can count, and is synchronous, so it runs where the bytes are
// handed to their consumer.

// The hash functions the specification names, weakest first. An algorithm
// missing from this list is not one the user agent supports, and metadata
// naming it is ignored.
const ALGORITHMS = ["sha256", "sha384", "sha512"];

const BASE64_VALUE = /^[A-Za-z0-9+/\-_]+={0,2}$/;

// https://w3c.github.io/webappsec-subresource-integrity/#parse-metadata
//
// Each whitespace-separated token is `algorithm-value[?options]`; the options
// are not interpreted. The algorithm is matched ASCII case-insensitively.
function parseMetadata(metadata) {
  const result = [];

  for (const token of String(metadata).split(/[\t\n\f\r ]+/)) {
    if (token === "") {
      continue;
    }

    const expression = token.split("?")[0];
    const dash = expression.indexOf("-");

    if (dash === -1) {
      continue;
    }

    const alg = expression.slice(0, dash).toLowerCase();

    if (!ALGORITHMS.includes(alg)) {
      continue;
    }

    // A digest that is not base64 or base64url (padding optional) names no
    // hash, and the token is ignored like one naming an unknown algorithm.
    const val = expression.slice(dash + 1);

    if (!BASE64_VALUE.test(val)) {
      continue;
    }

    result.push({ alg, val });
  }

  return result;
}

// https://w3c.github.io/webappsec-subresource-integrity/#get-the-strongest-metadata
function strongestMetadata(metadataList) {
  let strongest = [];
  let rank = -1;

  for (const item of metadataList) {
    const itemRank = ALGORITHMS.indexOf(item.alg);

    if (itemRank > rank) {
      strongest = [item];
      rank = itemRank;
    } else if (itemRank === rank) {
      strongest.push(item);
    }
  }

  return strongest;
}

// base64 and base64url name the same bytes; padding is optional in either.
function normalizeDigest(value) {
  return String(value).replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
}

function digestOf(bytes, alg) {
  return crypto.createHash(alg).update(bytes).digest("base64");
}

// https://w3c.github.io/webappsec-subresource-integrity/#does-response-match-metadatalist
//
// `bytes` is the whole body. Metadata with no token naming a supported
// algorithm matches anything, as the empty string does.
function bytesMatchMetadata(bytes, metadata) {
  const parsed = parseMetadata(metadata);

  if (parsed.length === 0) {
    return true;
  }

  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const digests = new Map();

  for (const item of strongestMetadata(parsed)) {
    if (!digests.has(item.alg)) {
      digests.set(item.alg, normalizeDigest(digestOf(buffer, item.alg)));
    }

    if (digests.get(item.alg) === normalizeDigest(item.val)) {
      return true;
    }
  }

  return false;
}

// Whether metadata asks for anything to be checked: the empty string, and a
// string with no token naming a supported algorithm, ask for nothing.
function hasIntegrityMetadata(metadata) {
  return typeof metadata === "string" && parseMetadata(metadata).length > 0;
}

module.exports = {
  parseMetadata,
  strongestMetadata,
  bytesMatchMetadata,
  hasIntegrityMetadata
};
