"use strict";
const conversions = require("webidl-conversions");
const { serializeURL } = require("whatwg-url");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const utils = require("../../utils");
const DOMException = require("../generated/DOMException");

function makeImageHolder() {
  const { Canvas } = utils;

  if (Canvas && typeof Canvas.Image === "function") {
    try {
      return new Canvas.Image();
    } catch (error) {
      // No document to make one from.
    }
  }

  return { width: 0, height: 0, src: "", onerror: null };
}
const { parseURLToResultingURLRecord } = require("../helpers/document-base-url");
const { queueAttributeMutationRecord } = require("../helpers/mutation-observers");
const { decodeImage } = require("../helpers/image-decoding");
const { asciiLowercase } = require("../helpers/strings");

class HTMLImageElementImpl extends HTMLElementImpl {
  constructor(...args) {
    super(...args);
    this._currentRequestState = "unavailable";

    // Settled by the request that is decoding, not by a timer: decode() hands
    // out a promise for a state this element reaches later, and a promise that
    // is never settled is worse than an absent method — a page that awaits one
    // before it paints stops there, with nothing thrown to say why.
    this._decodeWaiters = [];

    // Which run of "update the image data" is current. A run a later one has
    // replaced neither changes the element nor fires an event.
    this._imageUpdate = 0;
    this._imageRequest = null;

    // The rest of a run deferred by loading=lazy, until the host says the
    // element is near the viewport (_resumeLazyLoad) or loading stops being
    // lazy. While it is set the element is in its document's _lazyLoadImages.
    this._lazyLoadResumption = null;
  }

  _settleDecoders(error) {
    const waiters = this._decodeWaiters;

    this._decodeWaiters = [];

    for (const { resolve, reject } of waiters) {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
  }

  _decodeError() {
    return DOMException.create(this._globalObject, [
      "The source image could not be decoded.",
      "EncodingError"
    ]);
  }

  // https://html.spec.whatwg.org/multipage/embedded-content.html#dom-img-decode
  decode() {
    if (this._currentRequestState === "completely available") {
      return Promise.resolve();
    }

    if (this._currentRequestState === "broken") {
      return Promise.reject(this._decodeError());
    }

    const srcAttributeValue = this.getAttributeNS(null, "src");

    // Nothing is being fetched and nothing will be: the element has no source
    // to decode, which the spec rejects rather than leaves pending.
    if (srcAttributeValue === null || srcAttributeValue === "") {
      return Promise.reject(this._decodeError());
    }

    return new Promise((resolve, reject) => {
      this._decodeWaiters.push({ resolve, reject });
    });
  }

  _attrModified(name, value, oldVal) {
    // TODO: handle crossorigin
    if (name === "src" || ((name === "srcset" || name === "width" || name === "sizes") && value !== oldVal)) {
      this._updateTheImageData();
    }

    // https://html.spec.whatwg.org/multipage/embedded-content.html#attr-img-loading
    // Changed to the Eager state, a deferred load resumes.
    if (name === "loading" && !this._loadingIsLazy()) {
      this._resumeLazyLoad();
    }

    super._attrModified(name, value, oldVal);
  }

  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attributes
  // An enumerated attribute whose missing and invalid value default is Eager.
  get loading() {
    return this._loadingIsLazy() ? "lazy" : "eager";
  }

  set loading(value) {
    this.setAttributeNS(null, "loading", value);
  }

  _loadingIsLazy() {
    const value = this.getAttributeNS(null, "loading");

    return value !== null && asciiLowercase(value) === "lazy";
  }

  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#will-lazy-load-element-steps
  _willLazyLoad() {
    const window = this._ownerDocument._defaultView;

    return Boolean(window) && window._runScripts === "dangerously" && this._loadingIsLazy();
  }

  /**
   * Runs the rest of a deferred load. Called by whatever lays the document
   * out, when the element's box comes within the lazy load root margin of the
   * viewport; jsdom lays nothing out and never calls it.
   */
  _resumeLazyLoad() {
    const resumption = this._lazyLoadResumption;

    if (resumption === null) {
      return;
    }

    this._lazyLoadResumption = null;
    this._ownerDocument._lazyLoadImages?.delete(this);

    resumption();
  }

  // The request a run started, and a deferred run, given up on: neither will
  // change the element or fire an event, and neither delays the load event.
  _abandonImageRequest() {
    if (this._imageRequest !== null) {
      this._ownerDocument._resourceLoader.cancel?.(this._imageRequest);
      this._imageRequest = null;
    }

    if (this._lazyLoadResumption !== null) {
      this._lazyLoadResumption = null;
      this._ownerDocument._lazyLoadImages?.delete(this);
    }
  }

  _adoptingSteps(oldDocument) {
    // A deferred load is listed with the document it was deferred in.
    if (this._lazyLoadResumption !== null) {
      oldDocument._lazyLoadImages?.delete(this);
      this._registerLazyLoad();
    }

    super._adoptingSteps?.(oldDocument);
  }

  _registerLazyLoad() {
    const document = this._ownerDocument;

    if (!document._lazyLoadImages) {
      document._lazyLoadImages = new Set();
    }

    document._lazyLoadImages.add(this);
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
  /*
   * What the decoded size is kept on.
   *
   * The bytes are decoded by the decoder the host application installs, not by
   * this object: all it carries afterwards is a width and a height, and a src
   * that is assigned the empty string to let an onerror fire. The browser
   * build's Canvas.Image is a document element, which a worker has none of, so
   * where one cannot be made a plain holder stands in — it holds the same two
   * numbers, and reports no error, which is the decoder's to report.
   */
  _updateTheImageData() {
    const document = this._ownerDocument;

    if (!document._defaultView) {
      return;
    }

    if (!utils.Canvas) {
      return;
    }

    if (!this._image) {
      this._image = makeImageHolder();
    }
    this._currentSrc = null;
    this._currentRequestState = "unavailable";
    this._settleDecoders(this._decodeError());

    this._abandonImageRequest();

    const update = ++this._imageUpdate;
    const srcAttributeValue = this.getAttributeNS(null, "src");

    // No source: the element shows nothing, and reports no size.
    if (srcAttributeValue === null || srcAttributeValue === "") {
      this._imageData = null;
      this._image.src = "";
      return;
    }

    // The rest waits for a stable state, as the standard's does: a script that
    // sets src and then loading=lazy, or display: none, has done both before
    // anything is fetched.
    queueMicrotask(() => {
      if (update !== this._imageUpdate) {
        return;
      }

      if (this._willLazyLoad()) {
        this._lazyLoadResumption = () => this._fetchTheImage(update);
        this._registerLazyLoad();
        return;
      }

      this._fetchTheImage(update);
    });
  }

  _fetchTheImage(update) {
    const document = this._ownerDocument;

    if (update !== this._imageUpdate || !document._defaultView) {
      return;
    }

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

        if (update !== this._imageUpdate) {
          return;
        }

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
          this._settleDecoders(null);
          queueAttributeMutationRecord(this.parentElement, "__image_loaded__", null, null);
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

          const decoded = await decodeImage(data, imageContentType);

          if (!decoded) {
            throw new Error("Could not decode the image");
          }

          // Pixels rather than a bitmap when the decoder is one the host
          // application installed, which is how the bytes of a document's
          // images are kept away from the environment's own decoders.
          this._imageData = decoded.kind === "pixels" ?
            {
              type: "pixels",
              data: { pixels: decoded.data, width: decoded.width, height: decoded.height }
            } :
            { type: "bitmap", data: decoded.data };

          afterImageData();
        }
      };

      request = resourceLoader.fetch(urlString, {
        element: this,
        onLoad: onLoadImage,
        onError: () => {
          if (update !== this._imageUpdate) {
            return;
          }

          this._currentRequestState = "broken";
          this._settleDecoders(this._decodeError());
        }
      });

      this._imageRequest = request;
    } else {
      this._image.src = "";
    }
  }
}

module.exports = {
  implementation: HTMLImageElementImpl
};
