"use strict";

// Where a document's images are turned into pixels.
//
// The default hands the bytes to the host environment's own decoder, which is
// what an image element has always done. A host application that must not let
// the content of a document reach the environment it is running in installs its
// own decoder here instead; the return value is either a decoded bitmap or a
// raw RGBA buffer with its dimensions.

let decodeImage = async (bytes, mimeType) => {
  const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });

  return { kind: "bitmap", data: await createImageBitmap(blob) };
};

exports.setImageDecoder = decoder => {
  decodeImage = decoder;
};

exports.decodeImage = (bytes, mimeType) => decodeImage(bytes, mimeType);
