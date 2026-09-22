"use strict";

// Where a document's WebCrypto operations are performed.
//
// Crypto.webidl declares getRandomValues and randomUUID and nothing else, so
// crypto.subtle is absent. A page that gates on WebCrypto cannot be run at all
// without one: it takes the branch it would take in a browser too old for it.
//
// There is no default: SubtleCrypto is a large interface backed by primitives
// this library does not carry, and a partial one is worse than none, since the
// feature test that finds it passes and the operation then fails. A host
// application that can perform the operations installs a provider here.

// A function rather than the object, called on each read of crypto.subtle: the
// host application decides per document whether to answer, and a page already
// loaded sees the answer change.
let provideSubtleCrypto = null;

exports.setSubtleCrypto = provider => {
  provideSubtleCrypto = provider;
};

exports.getSubtleCrypto = () => (provideSubtleCrypto ? provideSubtleCrypto() : null);
