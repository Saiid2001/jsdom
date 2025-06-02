// https://url.spec.whatwg.org/#concept-urlencoded

function percentEncode(str) {
  let result = "";
  for (let i = 0; i < str.length; ++i) {
    const code = str.charCodeAt(i);
    const ch = str[i];
    if (
      (code >= 0x41 && code <= 0x5A) || // A-Z
      (code >= 0x61 && code <= 0x7A) || // a-z
      (code >= 0x30 && code <= 0x39) || // 0-9
      ch === "-" || ch === "." || ch === "_" || ch === "*" // allowed
    ) {
      result += ch;
    } else if (ch === " ") {
      result += "+";
    } else {
      // Percent-encode
      const hex = code.toString(16).toUpperCase();
      result += "%" + (hex.length === 1 ? "0" + hex : hex);
    }
  }
  return result;
}

module.exports = {
  serialize: function (entryList, encoding = "UTF-8") {
    const nameValuePairs = entryList.map((entry) => {
      if (typeof entry.value === "string") {
        return `${percentEncode(entry.name)}=${percentEncode(
          entry.value
        )}`;
      } else {
        notImplemented(
          "HTMLFormElement._mutateActionURL: entry value must be a string",
          this._ownerDocument._defaultView
        );
        return `${percentEncode(entry.name)}=`;
      }
    });

    return nameValuePairs.length ? nameValuePairs.join("&") : "";
  },
};
