"use strict";
const MIMEType = require("whatwg-mimetype");

// Reading a response's Content-Type and X-Content-Type-Options the way Fetch
// does, over any of the shapes a header list arrives in here: a Headers impl
// or wrapper, a header list, or a Node-style object whose values are strings
// or arrays of strings.

// One header's value, its several values combined with ", ", or null.
function headerValue(headers, name) {
  if (!headers) {
    return null;
  }

  const lower = name.toLowerCase();

  if (headers.headersList && typeof headers.headersList.get === "function") {
    const values = headers.headersList.get(lower);
    return values ? values.join(", ") : null;
  }

  if (typeof headers.get === "function") {
    const value = headers.get(lower);
    if (value === undefined || value === null) {
      return null;
    }
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      if (value === undefined || value === null) {
        return null;
      }
      return Array.isArray(value) ? value.join(", ") : String(value);
    }
  }

  return null;
}

// https://fetch.spec.whatwg.org/#header-value-get-decode-and-split
//
// Commas inside a quoted string do not split; a backslash inside one escapes
// the character after it. Each value has HTTP tab or space stripped from both
// ends, and nothing else.
function getDecodeSplit(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const input = String(value);
  const values = [];
  let position = 0;
  let temporaryValue = "";

  for (;;) {
    while (position < input.length && input[position] !== "\"" && input[position] !== ",") {
      temporaryValue += input[position];
      position++;
    }

    if (position < input.length && input[position] === "\"") {
      // https://fetch.spec.whatwg.org/#collect-an-http-quoted-string, extract-value false.
      const start = position;
      position++;
      for (;;) {
        while (position < input.length && input[position] !== "\"" && input[position] !== "\\") {
          position++;
        }
        if (position >= input.length) {
          break;
        }
        const quoteOrBackslash = input[position];
        position++;
        if (quoteOrBackslash === "\\") {
          if (position >= input.length) {
            break;
          }
          position++;
        } else {
          break;
        }
      }
      temporaryValue += input.slice(start, position);

      if (position < input.length) {
        continue;
      }
    }

    values.push(temporaryValue.replace(/^[\t ]+|[\t ]+$/g, ""));
    temporaryValue = "";

    if (position >= input.length) {
      return values;
    }

    // A comma.
    position++;
  }
}

// https://fetch.spec.whatwg.org/#concept-header-extract-mime-type
//
// The last value that parses names the type; a later value of the same essence
// without a charset keeps the charset an earlier one gave.
function extractMIMEType(headers) {
  const values = getDecodeSplit(headerValue(headers, "content-type"));

  if (values === null) {
    return null;
  }

  let charset = null;
  let essence = null;
  let mimeType = null;

  for (const value of values) {
    const temporaryMimeType = MIMEType.parse(value);

    if (temporaryMimeType === null || temporaryMimeType.essence === "*/*") {
      continue;
    }

    mimeType = temporaryMimeType;

    if (mimeType.essence !== essence) {
      charset = null;
      if (mimeType.parameters.has("charset")) {
        charset = mimeType.parameters.get("charset");
      }
      essence = mimeType.essence;
    } else if (!mimeType.parameters.has("charset") && charset !== null) {
      mimeType.parameters.set("charset", charset);
    }
  }

  return mimeType;
}

// https://fetch.spec.whatwg.org/#determine-nosniff
function determineNosniff(headers) {
  const values = getDecodeSplit(headerValue(headers, "x-content-type-options"));

  return values !== null && values.length > 0 && values[0].toLowerCase() === "nosniff";
}

// https://fetch.spec.whatwg.org/#request-destination-script-like, and "json".
const SCRIPT_LIKE = ["audioworklet", "paintworklet", "script", "serviceworker", "sharedworker", "worker", "json"];
const SCRIPT_LIKE_DESTINATIONS = new Set(SCRIPT_LIKE);

// https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-nosniff?
//
// `destination` is the request's. A "json" destination is a JSON module,
// whose type the module loader checks itself; it is not script-like here.
function blockedByNosniff(headers, destination) {
  if (!determineNosniff(headers)) {
    return false;
  }

  const mimeType = extractMIMEType(headers);

  if (destination !== "json" && SCRIPT_LIKE_DESTINATIONS.has(destination)) {
    return mimeType === null || !mimeType.isJavaScript();
  }

  if (destination === "style") {
    return mimeType === null || mimeType.essence !== "text/css";
  }

  return false;
}

// https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-mime-type?
function blockedByMIMEType(headers, destination) {
  const mimeType = extractMIMEType(headers);

  if (mimeType === null) {
    return false;
  }

  if (SCRIPT_LIKE_DESTINATIONS.has(destination) && destination !== "json" &&
      (["audio", "image", "video"].includes(mimeType.type) || mimeType.essence === "text/csv")) {
    return true;
  }

  return false;
}

module.exports = {
  headerValue,
  getDecodeSplit,
  extractMIMEType,
  determineNosniff,
  blockedByNosniff,
  blockedByMIMEType
};
