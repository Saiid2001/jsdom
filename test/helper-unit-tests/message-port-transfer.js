"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM } = require("../../lib/api.js");

// https://html.spec.whatwg.org/multipage/web-messaging.html#dom-messageport-postmessage
describe("Helpers: transferring through a MessagePort", () => {
  specify("an ArrayBuffer in the transfer list is detached from the sender and arrives intact", async () => {
    const { window } = new JSDOM();
    const channel = new window.MessageChannel();
    const array = new Uint8Array([1, 2, 3, 4]);

    const received = new Promise(resolve => {
      channel.port2.onmessage = event => resolve(event.data);
    });

    channel.port1.postMessage({ array }, [array.buffer]);
    assert.equal(array.byteLength, 0);

    const data = await received;
    assert.deepEqual([...data.array], [1, 2, 3, 4]);
  });

  specify("the transfer list may be given as an options dictionary", () => {
    const { window } = new JSDOM();
    const channel = new window.MessageChannel();
    const buffer = new ArrayBuffer(8);

    channel.port1.postMessage("", { transfer: [buffer] });
    assert.equal(buffer.byteLength, 0);
  });

  specify("a message without a transfer list is delivered as it was", async () => {
    const { window } = new JSDOM();
    const channel = new window.MessageChannel();
    const message = { port: channel.port1 };

    const received = new Promise(resolve => {
      channel.port2.onmessage = event => resolve(event.data);
    });

    channel.port1.postMessage(message);
    assert.equal(await received, message);
  });
});
