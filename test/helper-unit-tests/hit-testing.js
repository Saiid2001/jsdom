"use strict";
const assert = require("node:assert/strict");
const { describe, specify, afterEach } = require("mocha-sugar-free");

const { JSDOM, VirtualConsole, setHitTest, setLayoutGeometry, implSymbol } = require("../../lib/api.js");

// document.elementFromPoint() and elementsFromPoint(), answered by a hit test the host installs.
// https://drafts.csswg.org/cssom-view/#dom-document-elementfrompoint
// https://drafts.csswg.org/cssom-view/#dom-document-elementsfrompoint

function page(body = "") {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: "http://example.test/page.html",
    virtualConsole: new VirtualConsole()
  });
  window.innerWidth = 800;
  window.innerHeight = 600;
  return { window, document: window.document };
}

const impl = element => element[implSymbol];

// Compared by identity: a deep comparison of DOM objects walks the whole document graph.
function assertSameElements(actual, expected) {
  assert.equal(actual.length, expected.length, `${actual.length} elements, expected ${expected.length}`);
  expected.forEach((element, index) => assert.equal(actual[index], element, `element ${index}`));
}

describe("Helpers: hit testing", () => {
  afterEach(() => {
    setHitTest(null);
    setLayoutGeometry(null);
  });

  specify("with no hit test installed, elementFromPoint is null and elementsFromPoint empty", () => {
    const { document } = page(`<div></div>`);

    assert.equal(document.elementFromPoint(10, 10), null);
    assertSameElements(document.elementsFromPoint(10, 10), []);
  });

  specify("the hit test is asked in viewport coordinates and its topmost element is returned", () => {
    const { document } = page(`<div id="a"><span id="b"></span></div>`);
    const a = document.querySelector("#a");
    const b = document.querySelector("#b");
    const asked = [];

    setHitTest((documentImpl, x, y) => {
      asked.push([documentImpl, x, y]);
      return [impl(b), impl(a), impl(document.body)];
    });

    assert.equal(document.elementFromPoint(12.5, 40), b);
    assert.equal(asked.length, 1);
    assert.equal(asked[0][0], impl(document));
    assert.deepEqual(asked[0].slice(1), [12.5, 40]);
    assertSameElements(document.elementsFromPoint(12.5, 40), [b, a, document.body, document.documentElement]);
  });

  specify("a point over nothing answers the root element, and a point outside the viewport nothing", () => {
    const { document } = page();
    setHitTest(() => []);

    assert.equal(document.elementFromPoint(5, 5), document.documentElement);
    assertSameElements(document.elementsFromPoint(5, 5), [document.documentElement]);

    for (const [x, y] of [[-1, 5], [5, -1], [801, 5], [5, 601]]) {
      assert.equal(document.elementFromPoint(x, y), null);
      assertSameElements(document.elementsFromPoint(x, y), []);
    }
  });

  specify("a hit test with no scene to answer from (null, or throwing) is treated as no hit test", () => {
    const { document } = page();

    setHitTest(() => null);
    assert.equal(document.elementFromPoint(5, 5), null);
    assertSameElements(document.elementsFromPoint(5, 5), []);

    setHitTest(() => {
      throw new Error("renderer fault");
    });
    assert.equal(document.elementFromPoint(5, 5), null);
  });

  specify("the root element is not repeated, elements are not repeated, and other documents' nodes are dropped", () => {
    const { document } = page(`<p></p>`);
    const p = document.querySelector("p");
    const other = page(`<i></i>`).document.querySelector("i");

    setHitTest(() => [impl(p), impl(other), impl(p), impl(document.body), impl(document.documentElement)]);

    assertSameElements(document.elementsFromPoint(1, 1), [p, document.body, document.documentElement]);
  });

  specify("a shadow root's answer is retargeted against it, and the document's against the host", () => {
    const { document } = page(`<div id="host"></div>`);
    const host = document.querySelector("#host");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = "<span>in</span>";
    const span = shadow.firstChild;

    setHitTest(() => [impl(span), impl(host), impl(document.body)]);

    assert.equal(document.elementFromPoint(1, 1), host);
    assert.equal(shadow.elementFromPoint(1, 1), span);
    assertSameElements(document.elementsFromPoint(1, 1), [host, document.body, document.documentElement]);
    assertSameElements(shadow.elementsFromPoint(1, 1), [span, host, document.body, document.documentElement]);
  });

  specify("non-finite coordinates are a TypeError", () => {
    const { window, document } = page();
    setHitTest(() => []);

    assert.throws(() => document.elementFromPoint(NaN, 0), window.TypeError);
    assert.throws(() => document.elementsFromPoint(0, Infinity), window.TypeError);
  });

  // https://html.spec.whatwg.org/multipage/image-maps.html#image-map-processing-model
  describe("image maps", () => {
    // An image at (10, 20) in the viewport, 300 by 300, with the map named `map`, and the hit test landing on it.
    function imageMap(areas, { usemap = "#m", mapName = "m" } = {}) {
      const { document } = page(`<img usemap="${usemap}" width="300" height="300"><map name="${mapName}">${areas}</map>`);
      const img = document.querySelector("img");
      setLayoutGeometry(element => element === impl(img) ? { x: 10, y: 20, width: 300, height: 300 } : null);
      setHitTest((documentImpl, x, y) => {
        return x >= 10 && x < 310 && y >= 20 && y < 320 ? [impl(img), impl(document.body)] : [impl(document.body)];
      });
      const at = (x, y) => document.elementFromPoint(10 + x, 20 + y);
      return { document, img, at, areas: [...document.querySelectorAll("area")] };
    }

    specify("a point in an area's rect answers the area, and one outside it the image", () => {
      const { img, at, areas: [area], document } = imageMap(`<area shape="rect" coords="2,2,10,10">`);

      assert.equal(at(3, 3), area);
      assert.equal(at(9, 9), area);
      assert.equal(at(1, 3), img);
      assert.equal(at(11, 9), img);
      assertSameElements(document.elementsFromPoint(13, 23), [area, img, document.body, document.documentElement]);
    });

    specify("shape keywords, their aliases and defaults", () => {
      const circle = imageMap(`<area shape="CIRC" coords="20,40,10">`);
      assert.equal(circle.at(11, 40), circle.areas[0]);
      assert.equal(circle.at(12, 32), circle.img);

      const missing = imageMap(`<area coords="2,2,10,10">`);
      assert.equal(missing.at(3, 3), missing.areas[0]);

      const invalid = imageMap(`<area shape="foobar" coords="2,2,10,10">`);
      assert.equal(invalid.at(3, 3), invalid.areas[0]);

      const dotted = imageMap(`<area shape="c\u0130rcle" coords="20,40,10">`);
      assert.equal(dotted.at(20, 40), dotted.img);

      const whole = imageMap(`<area shape="default">`);
      assert.equal(whole.at(299, 299), whole.areas[0]);
    });

    specify("empty shapes are skipped, and rect corners are put in order", () => {
      for (const area of [`<area shape="rect" coords="2,2,10">`, `<area shape="circle" coords="20,40,0">`,
        `<area shape="poly" coords="100,100,120,100,100">`, `<area shape="rect">`]) {
        const map = imageMap(area);
        assert.equal(map.at(3, 3), map.img, area);
        assert.equal(map.at(101, 101), map.img, area);
      }

      const swapped = imageMap(`<area shape="rect" coords="10,10,2,2">`);
      assert.equal(swapped.at(3, 3), swapped.areas[0]);
    });

    specify("a polygon is filled by the even-odd rule, a trailing odd coordinate ignored", () => {
      const star = imageMap(`<area shape="poly" coords="100,100,200,100,100,200,150,50,200,200">`);
      assert.equal(star.at(101, 101), star.areas[0]);
      assert.equal(star.at(150, 51), star.areas[0]);
      assert.equal(star.at(150, 125), star.img);

      const extra = imageMap(`<area shape="poly" coords="100,100,120,100,100,120,300">`);
      assert.equal(extra.at(101, 101), extra.areas[0]);
      assert.equal(extra.at(118, 118), extra.img);
    });

    specify("coords are parsed as a list of floating-point numbers, garbage and all", () => {
      const map = imageMap(`<area shape="rect" coords=" 2;2 ,x10, 10e0 ">`);
      assert.equal(map.at(3, 3), map.areas[0]);
      assert.equal(map.at(11, 9), map.img);
    });

    specify("the map is found by an exact name or id, and the first area containing the point wins", () => {
      const casing = imageMap(`<area shape="default">`, { usemap: "#Simple", mapName: "simple" });
      assert.equal(casing.at(5, 5), casing.img);

      const byHash = imageMap(`<area shape="default">`, { usemap: "m", mapName: "m" });
      assert.equal(byHash.at(5, 5), byHash.img);

      const first = imageMap(`<area id="one" shape="rect" coords="0,0,50,50"><area id="two" shape="default">`);
      assert.equal(first.at(5, 5).id, "one");
      assert.equal(first.at(100, 100).id, "two");
    });
  });
});
