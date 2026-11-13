"use strict";
const Blob = require("../generated/Blob");
const { isArrayBuffer } = require("../generated/utils");
const { getStreams } = require("../helpers/streams");

function convertLineEndingsToNative(s) {
  // jsdom always pretends to be *nix, for consistency.
  // See also https://github.com/jsdom/jsdom/issues/2396.
  return s.replace(/\r\n|\r|\n/g, "\n");
}

exports.implementation = class BlobImpl {
  constructor(globalObject, args) {
    const parts = args[0];
    const properties = args[1];

    const buffers = [];

    if (parts !== undefined) {
      for (const part of parts) {
        let buffer;
        // A detached buffer holds no bytes, and a view onto one has none to give.
        if (isArrayBuffer(part)) {
          buffer = part.detached ? Buffer.alloc(0) : Buffer.from(part);
        } else if (ArrayBuffer.isView(part)) {
          buffer = part.buffer.detached ? Buffer.alloc(0) : Buffer.from(part.buffer, part.byteOffset, part.byteLength);
        } else if (Blob.isImpl(part)) {
          buffer = part._buffer;
        } else {
          let s = part;
          if (properties.endings === "native") {
            s = convertLineEndingsToNative(part);
          }
          buffer = Buffer.from(s);
        }
        buffers.push(buffer);
      }
    }

    this._buffer = Buffer.concat(buffers);
    this._globalObject = globalObject;

    this.type = properties.type;
    if (/[^\u0020-\u007E]/.test(this.type)) {
      this.type = "";
    } else {
      this.type = this.type.toLowerCase();
    }
  }

  get size() {
    return this._buffer.length;
  }

  slice(start, end, contentType) {
    const { size } = this;

    let relativeStart, relativeEnd, relativeContentType;

    if (start === undefined) {
      relativeStart = 0;
    } else if (start < 0) {
      relativeStart = Math.max(size + start, 0);
    } else {
      relativeStart = Math.min(start, size);
    }
    if (end === undefined) {
      relativeEnd = size;
    } else if (end < 0) {
      relativeEnd = Math.max(size + end, 0);
    } else {
      relativeEnd = Math.min(end, size);
    }

    if (contentType === undefined) {
      relativeContentType = "";
    } else {
      // sanitization (lower case and invalid char check) is done in the
      // constructor
      relativeContentType = contentType;
    }

    const span = Math.max(relativeEnd - relativeStart, 0);

    const buffer = this._buffer;
    const slicedBuffer = buffer.slice(
      relativeStart,
      relativeStart + span
    );

    const blob = Blob.createImpl(this._globalObject, [[], { type: relativeContentType }], {});
    blob._buffer = slicedBuffer;
    return blob;
  }

  // https://w3c.github.io/FileAPI/#dom-blob-stream
  // The Streams interfaces are the host application's; a document given none
  // has no ReadableStream to answer with.
  stream() {
    const streams = getStreams();

    if (!streams || typeof streams.ReadableStream !== "function") {
      throw new TypeError("Blob.prototype.stream is not supported: no ReadableStream is available");
    }

    const bytes = this._copyOfBytes();

    return new streams.ReadableStream({
      type: "bytes",
      start(controller) {
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes);
        }
        controller.close();
      }
    });
  }

  // https://w3c.github.io/FileAPI/#dom-blob-text
  text() {
    return Promise.resolve(new TextDecoder("utf-8").decode(this._buffer));
  }

  // https://w3c.github.io/FileAPI/#dom-blob-arraybuffer
  arrayBuffer() {
    return Promise.resolve(this._copyOfBytes().buffer);
  }

  // https://w3c.github.io/FileAPI/#dom-blob-bytes
  bytes() {
    return Promise.resolve(this._copyOfBytes());
  }

  // A Uint8Array of the page's realm over a buffer of its own: a Buffer is a
  // Node subclass, and the bytes behind it may be shared with other Blobs.
  _copyOfBytes() {
    const { Uint8Array: PageUint8Array } = this._globalObject;
    const Constructor = typeof PageUint8Array === "function" ? PageUint8Array : Uint8Array;
    const copy = new Constructor(this._buffer.length);
    copy.set(this._buffer);
    return copy;
  }
};
