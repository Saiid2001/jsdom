"use strict";

const nodeCrypto = require("crypto");
const DOMException = require("../generated/DOMException");

// https://w3c.github.io/webcrypto/#crypto-interface
class CryptoImpl {
  constructor(globalObject) {
    this._globalObject = globalObject;
  }

  // https://w3c.github.io/webcrypto/#Crypto-method-getRandomValues
  getRandomValues(array) {
    const typeName = getTypedArrayTypeName(array);
    if (!(typeName === "Int8Array" ||
        typeName === "Uint8Array" ||
        typeName === "Uint8ClampedArray" ||
        typeName === "Int16Array" ||
        typeName === "Uint16Array" ||
        typeName === "Int32Array" ||
        typeName === "Uint32Array" ||
        typeName === "BigInt64Array" ||
        typeName === "BigUint64Array")) {
      throw DOMException.create(this._globalObject, [
        `getRandomValues() only accepts integer typed arrays`,
        "TypeMismatchError"
      ]);
    }

    if (array.byteLength > 65536) {
      throw DOMException.create(this._globalObject, [
        `getRandomValues() cannot generate more than 65536 bytes of random values; ` +
        `${array.byteLength} bytes were requested`,
        "QuotaExceededError"
      ]);
    }
    // Filled through a byte view over the same buffer. The browser build
    // resolves "crypto" to a shim whose randomFillSync takes a Buffer or a
    // Uint8Array and rejects every other integer typed array, which is half of
    // what this method is required to accept.
    nodeCrypto.randomFillSync(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));

    return array;
  }

  // https://w3c.github.io/webcrypto/#Crypto-method-randomUUID
  randomUUID() {
    // The browser build resolves "crypto" to a shim that has no randomUUID,
    // and the TypeError went into the calling script: a consent dialog that
    // asks for one while recording a choice never closes.
    if (typeof nodeCrypto.randomUUID === "function") {
      return nodeCrypto.randomUUID();
    }

    // RFC 4122 4.4: sixteen random bytes, with the version and the variant
    // written over the bits reserved for them.
    const bytes = new Uint8Array(16);

    nodeCrypto.randomFillSync(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));

    return [
      hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10, 16)
    ].map(group => group.join("")).join("-");
  }
}

exports.implementation = CryptoImpl;

// See #3395. Subclasses of TypedArrays should properly work, but we can't rely
// on instanceof because Uint8Array may be different across different windows -
// which can happen in JSDOM when running { runScripts: "dangerously" }. As a
// solution, we imitate the behavior of instanceof by walking the proottype
// chain.
function getTypedArrayTypeName(array) {
  const target = array.constructor;
  const chain = [target.name];
  let proto = Object.getPrototypeOf(target);
  while (proto) {
    chain.push(proto.name);
    proto = Object.getPrototypeOf(proto);
  }

  while (chain.length > 0 && chain[chain.length - 1] !== "TypedArray") {
    chain.pop();
  }
  chain.reverse();
  return chain[1];
}
