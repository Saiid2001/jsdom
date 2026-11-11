"use strict";
const NODE_TYPE = require("../node-type");
const { HTML_NS } = require("./namespaces");
const { domSymbolTree } = require("./internal-constants");
const { asciiLowercase, parseFloatingPointNumber } = require("./strings");
const { borderBoxOf } = require("./layout-geometry");
const { nodeRoot } = require("./node");

// Which area of an image map a point over its image is in.
// https://html.spec.whatwg.org/multipage/image-maps.html#image-map-processing-model
//
// An image with a usemap hands a point over it to the first area of its map
// whose shape contains the point, which is then the hit target in the image's
// place. The coordinates are CSS pixels from the image's top left corner, taken
// here from its border box: the layout geometry source reports no content box.

const isHTML = (node, localName) =>
  node.nodeType === NODE_TYPE.ELEMENT_NODE && node._namespaceURI === HTML_NS && node._localName === localName;

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-hash-name-reference
function mapFor(img) {
  const usemap = img.getAttributeNS(null, "usemap");
  if (usemap === null || !usemap.startsWith("#") || usemap.length === 1) {
    return null;
  }
  const name = usemap.slice(1);

  const root = nodeRoot(img);
  for (const node of domSymbolTree.treeIterator(root)) {
    if (isHTML(node, "map") && (node.getAttributeNS(null, "id") === name || node.getAttributeNS(null, "name") === name)) {
      return node;
    }
  }
  return null;
}

const isSeparator = c => c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r" || c === "," || c === ";";

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-list-of-floating-point-numbers
function parseNumberList(input) {
  const numbers = [];
  let position = 0;

  const skipSeparators = () => {
    while (position < input.length && isSeparator(input[position])) {
      position++;
    }
  };

  skipSeparators();
  while (position < input.length) {
    while (position < input.length && !isSeparator(input[position]) && !/[0-9.-]/.test(input[position])) {
      position++;
    }

    const start = position;
    while (position < input.length && !isSeparator(input[position])) {
      position++;
    }

    numbers.push(parseFloatingPointNumber(input.slice(start, position)) ?? 0);
    skipSeparators();
  }

  return numbers;
}

const SHAPES = {
  circle: "circle",
  circ: "circle",
  default: "default",
  poly: "poly",
  polygon: "poly",
  rect: "rect",
  rectangle: "rect"
};

const MINIMUM_COORDS = { circle: 3, default: 0, poly: 6, rect: 4 };

// Even-odd rule: a ray from the point crosses the outline an odd number of times.
function insidePolygon(coords, x, y) {
  let inside = false;
  const count = coords.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = coords[2 * i];
    const yi = coords[2 * i + 1];
    const xj = coords[2 * j];
    const yj = coords[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Whether `area`'s shape contains a point given relative to the image, its shape left empty where its coords are too
// few or describe nothing.
function areaContains(area, x, y, width, height) {
  const keyword = asciiLowercase(area.getAttributeNS(null, "shape") ?? "rect");
  const shape = SHAPES[keyword] ?? "rect";
  let coords = parseNumberList(area.getAttributeNS(null, "coords") ?? "");

  if (coords.length < MINIMUM_COORDS[shape]) {
    return false;
  }

  switch (shape) {
    case "default":
      return x >= 0 && x < width && y >= 0 && y < height;
    case "circle": {
      const [cx, cy, radius] = coords;
      return radius > 0 && (x - cx) ** 2 + (y - cy) ** 2 < radius ** 2;
    }
    case "poly":
      if (coords.length % 2 === 1) {
        coords = coords.slice(0, -1);
      }
      return insidePolygon(coords, x, y);
    default: {
      const [left, right] = coords[0] <= coords[2] ? [coords[0], coords[2]] : [coords[2], coords[0]];
      const [top, bottom] = coords[1] <= coords[3] ? [coords[1], coords[3]] : [coords[3], coords[1]];
      return x >= left && x < right && y >= top && y < bottom;
    }
  }
}

/** The area of `element`'s image map containing a viewport point, or null where it has none there. */
exports.areaAtPoint = (element, x, y) => {
  if (!isHTML(element, "img")) {
    return null;
  }

  const map = mapFor(element);
  if (!map) {
    return null;
  }

  const box = borderBoxOf(element);
  if (!box) {
    return null;
  }

  for (const node of domSymbolTree.treeIterator(map)) {
    if (isHTML(node, "area") && areaContains(node, x - box.x, y - box.y, box.width, box.height)) {
      return node;
    }
  }
  return null;
};
