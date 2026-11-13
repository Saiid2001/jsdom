"use strict";
const { Readable } = require("readable-stream");
const Blob = require("../generated/Blob");
const idlUtils = require("../generated/utils");
const { extractMIMEType } = require("../helpers/content-type");
const xWWWFormUrlEncoded = require("../serializers/xWWWFormUrlEncoded");
const MultipartForm = require("../serializers/MultipartForm");
const XMLHttpRequestExtractBody = require("../xhr/XMLHttpRequest-impl").extractBody;
const { getStreams } = require("../helpers/streams");

// A body as the Streams interfaces describe it, over the readable it is carried
// on internally. Chunks are passed on as they arrive rather than when the
// reader asks for them: the readable is already buffering the whole response,
// so there is nothing upstream for backpressure to reach.
function asReadableStream(nodeStream, ReadableStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", chunk => {
        controller.enqueue(typeof chunk === "string" ?
          new TextEncoder().encode(chunk) :
          new Uint8Array(chunk.buffer ?? chunk, chunk.byteOffset ?? 0, chunk.byteLength ?? chunk.length));
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", error => controller.error(error));
    },

    cancel(reason) {
      if (typeof nodeStream.destroy === "function") {
        nodeStream.destroy(reason);
      }
    }
  });
}

function isReadableStream(stream) {
    // Check if the stream is an instance of ReadableStream
    return stream instanceof Readable || (stream && typeof stream.pipe === "function" && typeof stream.on === "function");
}

// Create a ReadableStream from the body buffer
function createReadableStreamFromBody(bodyBuffer, context) {
    if (!bodyBuffer) {
        // Return an empty stream
        return {
            stream: Readable.from([]),
            contentType: null,
        }
    }
    // If bodyBuffer is a Buffer or string, create a stream from it
    if (Buffer.isBuffer(bodyBuffer) || typeof bodyBuffer === "string") {
        return {
            stream: Readable.from([bodyBuffer]),
            contentType: null, // Content type can be set based on context or headers if available
        };
    }

    // If already a stream, return as is
    if (isReadableStream(bodyBuffer)) {
        return {
            stream: bodyBuffer,
            contentType: null, // Content type can be set based on context or headers if available
        };
    }

    // Otherwise try using the XMLHttpRequest body extraction
    try {
        const { buffer, formData, contentType } = XMLHttpRequestExtractBody(bodyBuffer, context);
        if (buffer || formData) {
            return {
                stream: Readable.from([buffer || formData]),
                contentType: contentType || null,
            };
        }
    } 
    finally {}


    throw new TypeError("Unsupported body type for stream");
}


// A ReadableStream's chunks, whole. Each must be a Uint8Array
// (https://fetch.spec.whatwg.org/#concept-read-all-bytes-from-readablestream).
async function readAll(stream) {
    const reader = stream.getReader();
    const chunks = [];

    for (;;) {
        const { done, value } = await reader.read();

        if (done) {
            return Buffer.concat(chunks);
        }

        if (Object.prototype.toString.call(value) !== "[object Uint8Array]") {
            throw new TypeError("A body's stream gave a chunk that is not a Uint8Array");
        }

        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
}

// Minimal consumeBody implementation
function consumeBody(bodyBuffer, type, headers, globalObject) {
    // Example: handle text and json
    if (type === "text") {
        return Promise.resolve(bodyBuffer ? bodyBuffer.toString() : "");
    }
    if (type === "json") {
        return Promise.resolve(bodyBuffer ? JSON.parse(bodyBuffer.toString()) : null);
    }
    if (type === "arraybuffer") {
        return Promise.resolve(bodyBuffer ? bodyBuffer.buffer.slice(bodyBuffer.byteOffset, bodyBuffer.byteOffset + bodyBuffer.byteLength) : new ArrayBuffer(0));
    }
    if (type === "blob") {
        // https://fetch.spec.whatwg.org/#dom-body-blob: the bytes, typed with
        // the MIME type extracted from the header list, serialized as it
        // parsed rather than lowercased as Blob's constructor would.
        const mimeType = extractMIMEType(headers);
        const impl = Blob.createImpl(globalObject, [[bodyBuffer || Buffer.alloc(0)], { type: "" }]);
        impl.type = mimeType === null ? "" : mimeType.toString();
        return Promise.resolve(idlUtils.wrapperForImpl(impl));
    }
    if (type === "formdata") {
        const contentType = headers && headers.get("content-type") || "application/x-www-form-urlencoded";

        if (contentType.startsWith("application/x-www-form-urlencoded")) {
            return Promise.resolve(xWWWFormUrlEncoded.parse(bodyBuffer.toString()));
        }

        if (contentType.startsWith("multipart/form-data")) {
            // For multipart/form-data, we would need to parse the bodyBuffer
            return Promise.resolve(MultipartForm.parse(bodyBuffer, headers));
        }
    }


    // Add blob/formData as needed
    return Promise.reject(new Error("Not implemented"));
}

class BodyImpl {



    // The body is one stream for the life of the object: reading it twice has
    // to hand back the same one, or the second reader takes over a body the
    // first is partway through. _computeBodyStream answers with the stream and
    // its content type together, so what is cached here is the stream itself.
    get body() {
        if (this._bodyUsed) {
            return null;
        }

        if (this._bodySource) {
            return this._bodySource;
        }

        if (this._bodyStream === undefined) {
            const typed = this._computeBodyStream();
            const nodeStream = typed ? typed.stream : null;
            const streams = getStreams();

            this._bodyStream = nodeStream && streams?.ReadableStream ?
                asReadableStream(nodeStream, streams.ReadableStream) :
                nodeStream;
        }

        return this._bodyStream;
    }

    _computeBodyStream() {
        if (this._bodyUsed) {
            return null;
        }
        if (this._typedStream) {
            return this._typedStream;
        }
        this._typedStream = createReadableStreamFromBody(this._bodyBuffer, this);
        return this._typedStream;
    }

    get bodyUsed() {
        return Boolean(this._bodyUsed);
    }

    async arrayBuffer() {
        return this._consumeBody("arraybuffer");
    }

    async blob() {
        return this._consumeBody("blob");
    }

    async formData() {
        return this._consumeBody("formdata");
    }

    async json() {
        return this._consumeBody("json");
    }

    async text() {
        return this._consumeBody("text");
    }

    _consumeBody(type) {
        if (this._bodyUsed) {
            return Promise.reject(new TypeError("Body has already been consumed."));
        }
        if (this._bodySource) {
            const source = this._bodySource;

            this._bodySource = null;
            this._bodyUsed = true;

            return readAll(source).then(buffer => consumeBody(buffer, type, this.headers, this._globalObject));
        }
        // A body that does not exist reads as empty and is never used up.
        if (this._bodyBuffer !== null && this._bodyBuffer !== undefined) {
            this._bodyUsed = true;
        }
        return consumeBody(this._bodyBuffer, type, this.headers, this._globalObject);
    }
}

module.exports = {
    implementation: BodyImpl,
};