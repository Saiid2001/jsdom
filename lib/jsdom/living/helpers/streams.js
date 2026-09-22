"use strict";

// Where the Streams interfaces come from.
//
// A body here is a Node readable: it has pipe and on, and none of getReader,
// pipeThrough or tee. A page that consumes a response as it arrives reaches for
// those, and cannot make a stream of its own either, because ReadableStream is
// not on the window.
//
// There is no default: the host application says which constructors a document
// may use, and with none installed a body stays the readable it is.

let provideStreams = null;

exports.setStreams = provider => {
  provideStreams = provider;
};

exports.getStreams = () => (provideStreams ? provideStreams() : null);
