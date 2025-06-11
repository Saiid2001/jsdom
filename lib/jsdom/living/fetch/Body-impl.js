"use strict";
const { Readable } = require("readable-stream");
const Blob = require("../generated/Blob");
const xWWWFormUrlEncoded = require("../serializers/xWWWFormUrlEncoded");
const MultipartForm = require("../serializers/MultipartForm");
const XMLHttpRequestExtractBody = require("../xhr/XMLHttpRequest-impl").extractBody;

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


// Minimal consumeBody implementation
function consumeBody(bodyBuffer, type, headers) {
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
        // For blob, we would typically need to create a Blob object
        // This is a placeholder; actual implementation would depend on the environment
        return Promise.resolve(new Blob([bodyBuffer]));
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



    get body() {
        if (this._typedStream) {
            return this._typedStream;
        }
        if (this._bodyUsed) {
            return null;
        }
        this._typedStream = this._computeBodyStream();
        return this._typedStream ? this._typedStream.stream : null;
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
        return this._bodyUsed;
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
        this._bodyUsed = true;
        return consumeBody(this._bodyBuffer, type, this.headers);
    }
}

module.exports = {
    implementation: BodyImpl,
};