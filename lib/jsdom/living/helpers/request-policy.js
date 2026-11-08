"use strict";

// Whether a request the document makes may be sent at all.
//
// This library sends what it is asked for. A host application that carries
// these requests over a network stack of its own may hold a position on which
// addresses are allowed to leave -- a scheme it will not carry, a host it will
// not reach -- and installs it here. The default holds none, which is this
// library's behaviour with no host involved.
//
// The reason it is here rather than in the resource loader is that XHR and
// fetch do not go through the resource loader: a policy applied only there
// would cover a document and its subresources and nothing a script asks for.

let refuseRequest = () => null;

exports.setRequestPolicy = policy => {
  refuseRequest = policy;
};

// Why a request to this URL is refused, or null when it may be sent.
exports.refuseRequest = url => {
  try {
    return refuseRequest(url) || null;
  } catch (err) {
    // A policy that throws must not become a request that is sent.
    return String(err && err.message ? err.message : err);
  }
};
