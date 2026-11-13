"use strict";
// https://url.spec.whatwg.org/#concept-urlencoded
const { percentEncodeAfterEncoding } = require("../helpers/encoding-encoders");

// https://url.spec.whatwg.org/#application-x-www-form-urlencoded-percent-encode-set
// leaves only ASCII alphanumerics, "*", "-", "." and "_".
function inURLEncodedSet(byte) {
  const isAlphanumeric = (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5A) ||
    (byte >= 0x61 && byte <= 0x7A);
  return !isAlphanumeric && byte !== 0x2A && byte !== 0x2D && byte !== 0x2E && byte !== 0x5F;
}

function percentEncode(string, encoding) {
  return percentEncodeAfterEncoding(encoding, string, inURLEncodedSet, true);
}

module.exports = {
  // https://url.spec.whatwg.org/#concept-urlencoded-serializer
  // A file entry is serialized as its name, as converting an entry list to a
  // list of name-value pairs does.
  serialize(entryList, encoding = "UTF-8") {
    return entryList.map(entry => {
      const value = typeof entry.value === "string" ? entry.value : entry.value.name;
      return `${percentEncode(entry.name, encoding)}=${percentEncode(value, encoding)}`;
    }).join("&");
  },

  parse(data) {
    const entryList = [];
    const pairs = data.split("&");
    for (const pair of pairs) {
      const [name, value] = pair.split("=");
      if (name) {
        entryList.push({
          name: decodeURIComponent(name.replace(/\+/g, " ")),
          value: decodeURIComponent(value ? value.replace(/\+/g, " ") : "")
        });
      }
    }
    return entryList;
  }
};
