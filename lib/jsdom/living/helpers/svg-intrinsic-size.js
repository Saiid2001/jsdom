"use strict";

// The natural size of an SVG image: its root element's width and height where
// they are lengths in pixels, one of them completed by the viewBox's ratio
// where only one is, and the viewBox's own size where neither is. Null where
// none of that is given. Read off the root's start tag rather than a parse of
// the document: an image's markup is not this document's.
// https://svgwg.org/svg2-draft/coords.html#SizingSVGInCSS

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);

  return match ? match[1] ?? match[2] : null;
}

function pixels(value) {
  const match = /^\s*(\d*\.?\d+)\s*(px)?\s*$/.exec(value ?? "");

  return match ? Number(match[1]) : null;
}

exports.svgIntrinsicSize = markup => {
  const root = /<svg\b[^>]*>/i.exec(markup);

  if (!root) {
    return null;
  }

  const tag = root[0];
  const width = pixels(attribute(tag, "width"));
  const height = pixels(attribute(tag, "height"));
  const viewBox = (attribute(tag, "viewBox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const ratio = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox[2] / viewBox[3] : null;

  if (width !== null && height !== null) {
    return { width, height };
  }

  if (width !== null && ratio !== null) {
    return { width, height: width / ratio };
  }

  if (height !== null && ratio !== null) {
    return { width: height * ratio, height };
  }

  return ratio === null ? null : { width: viewBox[2], height: viewBox[3] };
};
