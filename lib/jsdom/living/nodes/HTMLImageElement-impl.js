"use strict";
const conversions = require("webidl-conversions");
const { serializeURL } = require("whatwg-url");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const { Canvas } = require("../../utils");
const { parseURLToResultingURLRecord } = require("../helpers/document-base-url");

class HTMLImageElementImpl extends HTMLElementImpl {
  constructor(...args) {
    super(...args);
    this._currentRequestState = "unavailable";
  }

  _attrModified(name, value, oldVal) {
    // TODO: handle crossorigin
    if (name === "src" || ((name === "srcset" || name === "width" || name === "sizes") && value !== oldVal)) {
      this._updateTheImageData();
    }

    super._attrModified(name, value, oldVal);
  }

  get _accept() {
    return "image/png,image/*;q=0.8,*/*;q=0.5";
  }

  get height() {
    // Just like on browsers, if no width / height is defined, we fall back on the
    // dimensions of the internal image data.
    return this.hasAttributeNS(null, "height") ?
           conversions["unsigned long"](this.getAttributeNS(null, "height")) :
           this.naturalHeight;
  }

  set height(V) {
    this.setAttributeNS(null, "height", String(V));
  }

  get width() {
    return this.hasAttributeNS(null, "width") ?
           conversions["unsigned long"](this.getAttributeNS(null, "width")) :
           this.naturalWidth;
  }

  set width(V) {
    this.setAttributeNS(null, "width", String(V));
  }

  get naturalHeight() {
    return this._imageData ? this._imageData.data.height : 0;
  }

  get naturalWidth() {
    return this._imageData ? this._imageData.data.width : 0;
  }

  get complete() {
    const srcAttributeValue = this.getAttributeNS(null, "src");
    return srcAttributeValue === null ||
      srcAttributeValue === "" ||
      this._currentRequestState === "broken" ||
      this._currentRequestState === "completely available";
  }

  get currentSrc() {
    return this._currentSrc || "";
  }

  get srcData() {
    return this._imageData;
  }

  // https://html.spec.whatwg.org/multipage/images.html#updating-the-image-data
  _updateTheImageData() {
    const document = this._ownerDocument;

    if (!document._defaultView) {
      return;
    }

    if (!Canvas) {
      return;
    }

    if (!this._image) {
      this._image = new Canvas.Image();
    }
    this._currentSrc = null;
    this._currentRequestState = "unavailable";
    const srcAttributeValue = this.getAttributeNS(null, "src");
    let urlString = null;
    if (srcAttributeValue !== null && srcAttributeValue !== "") {
      const urlRecord = parseURLToResultingURLRecord(srcAttributeValue, this._ownerDocument);
      if (urlRecord === null) {
        return;
      }
      urlString = serializeURL(urlRecord);
    }
    if (urlString !== null) {
      const resourceLoader = document._resourceLoader;
      let request;

      const onLoadImage = async (data) => {
        const { response } = request;

        if (response && response.statusCode !== undefined && response.statusCode !== 200) {
          throw new Error("Status code: " + response.statusCode);
        }

        const afterImageData = () => {
          let error = null;
          this._image.onerror = function (err) {
            error = err;
          };
          this._image.src = "";
          if (error) {
            throw new Error(error);
          }
          this._currentSrc = srcAttributeValue;
          this._currentRequestState = "completely available";
        };

        // convert to image bitmap or SVG data
        const imageContentType = response.headers["content-type"];

        // handle svg
        if (imageContentType && imageContentType.indexOf("svg") !== -1) {
          const svgElementMarkup = new TextDecoder("utf-8").decode(data);

          // extract the width and height from the SVG viewBox
          const viewBoxMatch = svgElementMarkup.match(/viewBox="([^"]+)"/);
          if (viewBoxMatch) {
            const viewBox = viewBoxMatch[1].split(" ");
            const width = parseFloat(viewBox[2]);
            const height = parseFloat(viewBox[3]);

            // set the image dimensions
            this._image.width = width;
            this._image.height = height;
          } else {
            // fallback to default dimensions
            this._image.width = 100;
            this._image.height = 100;
          }

          this._imageData = {
            type: "svg",
            data: {
              markup: svgElementMarkup,
              width: this._image.width,
              height: this._image.height,
            },
          };
          afterImageData();
        } else {
          // handle png, jpeg, gif

          let blob = new Blob([data], {
            type: imageContentType,
          });
          const bitmap = await createImageBitmap(blob);
          this._imageData = {
            type: "bitmap",
            data: bitmap,
          };
          afterImageData();
        }
      };

      request = resourceLoader.fetch(urlString, {
        element: this,
        onLoad: onLoadImage,
        onError: () => {
          this._currentRequestState = "broken";
        }
      });
    } else {
      this._image.src = "";
    }
  }
}

module.exports = {
  implementation: HTMLImageElementImpl
};
