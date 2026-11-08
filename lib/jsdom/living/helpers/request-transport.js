"use strict";

// How a request this library makes reaches the network.
//
// Everything but the resource loader goes out through living/helpers/
// http-request.js, which asks the environment for `http` and gets whatever it
// provides. A host application that carries these requests some other way --
// over a connection of its own, or not over the environment's network at all
// -- installs that here, and is handed each request before one is made.
//
// A transport answers with an object standing in for a ClientRequest, or null
// to leave the request to be made the way it otherwise would be. The default
// holds none, which is this library's behaviour with no host involved.

let openRequest = () => null;

exports.setRequestTransport = transport => {
  openRequest = transport;
};

exports.openRequest = (options, onResponse) => {
  try {
    return openRequest(options, onResponse) || null;
  } catch (err) {
    // A transport that throws must not become a request that is never made.
    return null;
  }
};
