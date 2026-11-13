"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole, setRequestTransport } = require("../../lib/api.js");

// An upload is complete once its body has been sent, not once a response has
// arrived. The two coincide for a request answered directly; a transport that
// follows a redirect itself answers only with the last response, by which time
// the XHR has reached HEADERS_RECEIVED, and the upload's progress was fired
// there rather than while the request was still OPENED.

/** A transport that sends the body, says so, and answers some time later. */
function transport(options, onResponse) {
  const request = new EventEmitter();

  // As a ClientRequest does, the callback is the first listener.
  request.once("response", onResponse);

  request.setHeader = () => {};
  request.getHeader = () => null;
  request.removeHeader = () => {};
  request.write = () => true;
  request.abort = request.destroy = () => {};
  request.end = () => {
    setTimeout(() => {
      request.emit("finish");

      setTimeout(() => {
        const response = new EventEmitter();

        response.statusCode = 200;
        response.statusMessage = "OK";
        response.headers = { "content-type": "text/plain" };
        response.rawHeaders = ["content-type", "text/plain"];
        response.pipe = () => {};
        request.emit("response", response);
        setTimeout(() => {
          response.emit("data", Buffer.from("ok"));
          response.emit("end");
        }, 0);
      }, 20);
    }, 0);
  };

  return request;
}

describe("Helpers: an XHR upload completes when its body is sent", () => {
  specify("upload progress fires while the request is still OPENED", async () => {
    setRequestTransport(transport);

    const { window } = new JSDOM("", { url: "https://site.test/", virtualConsole: new VirtualConsole() });

    try {
      const states = await new Promise(resolve => {
        const xhr = new window.XMLHttpRequest();
        const seen = [];

        xhr.upload.onprogress = () => seen.push(`progress ${xhr.readyState}`);
        xhr.upload.onloadend = () => seen.push(`loadend ${xhr.readyState}`);
        xhr.onloadend = () => resolve(seen);
        xhr.open("POST", "https://site.test/upload");
        xhr.send("x".repeat(1000));
      });

      assert.deepEqual(states, ["progress 1", "loadend 1"]);
    } finally {
      setRequestTransport(() => null);
      window.close();
    }
  });
});
