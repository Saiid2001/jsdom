"use strict";
const idlUtils = require("../generated/utils");
const Blob = require("../generated/Blob");
const FormData = require("../generated/FormData");
const { isArrayBuffer } = require("../generated/utils");

// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm
// Names and filenames escape LF, CR and " as %0A, %0D and %22; names and string values have their newlines
// normalized to CRLF first.
function escapeField(string) {
  return string.replace(/\n/g, "%0A").replace(/\r/g, "%0D").replace(/"/g, "%22");
}

function normalizeNewlines(string) {
  return string.replace(/\r\n|\r|\n/g, "\r\n");
}

function randomBoundary() {
  let suffix = "";
  for (let i = 0; i < 16; ++i) {
    suffix += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)];
  }
  return `----formdata-jsdom-${suffix}`;
}

function encodeMultipart(entries) {
  const boundary = randomBoundary();
  const chunks = [];

  for (const { name, value } of entries) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeField(normalizeNewlines(name))}"`;

    if (Blob.isImpl(value)) {
      const filename = typeof value.name === "string" ? value.name : "blob";
      const type = value.type || "application/octet-stream";
      head += `; filename="${escapeField(filename)}"\r\nContent-Type: ${type}\r\n\r\n`;
      chunks.push(Buffer.from(head), value._buffer, Buffer.from("\r\n"));
    } else {
      head += `\r\n\r\n${normalizeNewlines(value)}\r\n`;
      chunks.push(Buffer.from(head));
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { buffer: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

// https://fetch.spec.whatwg.org/#concept-bodyinit-extract, for every BodyInit but a ReadableStream: the bytes and
// the content type the body's kind gives it, or null for an object that is none of them (a stream among them),
// which is left to the caller.
exports.extractBody = body => {
  const impl = idlUtils.implForWrapper(body) || body;

  if (typeof body === "string") {
    return { buffer: Buffer.from(body, "utf-8"), contentType: "text/plain;charset=UTF-8" };
  }
  if (Blob.isImpl(impl)) {
    return { buffer: impl._buffer, contentType: impl.type === "" ? null : impl.type };
  }
  if (FormData.isImpl(impl)) {
    return encodeMultipart(impl._entries);
  }
  if (isArrayBuffer(body)) {
    return { buffer: Buffer.from(body.slice(0)), contentType: null };
  }
  if (ArrayBuffer.isView(body)) {
    const bytes = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    return { buffer: Buffer.from(bytes), contentType: null };
  }
  if (Object.prototype.toString.call(body) === "[object URLSearchParams]") {
    const contentType = "application/x-www-form-urlencoded;charset=UTF-8";
    return { buffer: Buffer.from(String(body), "utf-8"), contentType };
  }

  return null;
};
