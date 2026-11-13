"use strict";

// https://html.spec.whatwg.org/multipage/custom-elements.html#customstateset
//
// setlike<DOMString>, which webidl2js does not generate, so the interface is written out here: a set of strings
// whose methods are the set's own, installed on each window like the interfaces that are generated.

const sets = new WeakMap();

// Each window's way to make a set, kept here rather than on the window, where a page would find it.
const factories = new WeakMap();

function setOf(object) {
  const set = sets.get(object);
  if (!set) {
    throw new TypeError("Illegal invocation");
  }
  return set;
}

exports.install = window => {
  let constructing = false;

  class CustomStateSet {
    constructor() {
      if (!constructing) {
        throw new TypeError("Illegal constructor");
      }
      sets.set(this, new Set());
    }

    get size() {
      return setOf(this).size;
    }

    has(value) {
      return setOf(this).has(`${value}`);
    }

    add(value) {
      setOf(this).add(`${value}`);
      return this;
    }

    delete(value) {
      return setOf(this).delete(`${value}`);
    }

    clear() {
      setOf(this).clear();
    }

    forEach(callback, thisArg) {
      for (const value of setOf(this)) {
        callback.call(thisArg, value, value, this);
      }
    }

    values() {
      return setOf(this).values();
    }

    entries() {
      return setOf(this).entries();
    }
  }

  Object.defineProperty(CustomStateSet.prototype, "keys", {
    value: CustomStateSet.prototype.values, writable: true, enumerable: true, configurable: true
  });
  Object.defineProperty(CustomStateSet.prototype, Symbol.iterator, {
    value: CustomStateSet.prototype.values, writable: true, enumerable: false, configurable: true
  });
  Object.defineProperty(CustomStateSet.prototype, Symbol.toStringTag, {
    value: "CustomStateSet", configurable: true
  });

  Object.defineProperty(window, "CustomStateSet", {
    value: CustomStateSet, writable: true, enumerable: false, configurable: true
  });

  factories.set(window, () => {
    constructing = true;
    try {
      return new CustomStateSet();
    } finally {
      constructing = false;
    }
  });
};

// A new CustomStateSet of the window's.
exports.create = window => factories.get(window)();

// The states a set holds, for a host application or a selector engine that asks.
exports.statesOf = set => sets.get(set);
