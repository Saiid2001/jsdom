const notImplemented = require("../../browser/not-implemented");
const { FormDataEncoder } = require("form-data-encoder");
const { Readable } = require("readable-stream");
const multipart = require('parse-multipart-data');

class FormDataLike {
  constructor(entryList) {
    if (entryList)
      this._entries = entryList.map((e) => ({ name: e.name, value: e.value }));
    else this._entries = [];
  }

  append(name, value) {
    this._entries.push({ name, value });
  }

  getAll(name) {
    return this._entries.filter((e) => e.name === name).map((e) => e.value);
  }

  *entries() {
    for (const entry of this._entries) {
      yield [entry.name, entry.value];
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  get [Symbol.toStringTag]() {
    return "FormData";
  }
}

module.exports = {
  serialize: async function (entryList, encoding = "UTF-8") {
    form = new FormDataLike();

    for (const entry of entryList) {
      if (typeof entry.value === "string") {
        form.append(entry.name, entry.value);
      } else {
        notImplemented(
          "HTMLFormElement._mutateActionURL: entry value must be a string",
          this._ownerDocument._defaultView
        );

        form.append(entry.name, "");
      }
    }

    const encoder = new FormDataEncoder(form);
    const body = Readable.from(encoder.encode());

    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }

    let headers = {}

    // encoder.headers is proxy object
    for (const [key, value] of Object.entries(encoder.headers)) {
      headers[key] = value;
    }

    return {
        headers,
        buffer: Buffer.concat(chunks)
    };
  },

  parse: function (buffer, headers) {
    const form = new FormDataLike();
    
    const boundary = multipart.getBoundary(headers["content-type"]);

    const parts = multipart.Parse(buffer, boundary);
    // list of { name?, value, filename, type }
    for (const part of parts) {

      if (part.type && part.type !== "text/plain") {
        // not supported type, skip
        notImplemented(
          `MultipartForm: unsupported part type ${part.type}`,
          this._ownerDocument._defaultView
        );
        continue;
      }

      if (part.name) {

        form.append(part.name, part.value);
      } else {
        // If no name, just append the value
        // form.append("", part.value);
        notImplemented(
          "MultipartForm: part without name",
          this._ownerDocument._defaultView
        );
      }
    }

  }

};
