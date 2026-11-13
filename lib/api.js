"use strict";
const path = require("path");
const fs = require("fs").promises;
const vm = require("vm");
const toughCookie = require("tough-cookie");
const whatwgURL = require("whatwg-url");
const { sniffHTMLEncoding, decode: decodeBytes } = require("./jsdom/living/helpers/encoding");
const { URL } = require("whatwg-url");
const MIMEType = require("whatwg-mimetype");
const idlUtils = require("./jsdom/living/generated/utils.js");
const VirtualConsole = require("./jsdom/virtual-console.js");
const { createWindow } = require("./jsdom/browser/Window.js");
const { parseIntoLoadingDocument } = require("./jsdom/browser/parser");
const { fragmentSerialization } = require("./jsdom/living/domparsing/serialization.js");
const ResourceLoader = require("./jsdom/browser/resources/resource-loader.js");
const NoOpResourceLoader = require("./jsdom/browser/resources/no-op-resource-loader.js");
const utils = require("./jsdom/living/generated/utils.js");

class CookieJar extends toughCookie.CookieJar {
  constructor(store, options) {
    // jsdom cookie jars must be loose by default
    super(store, { looseMode: true, ...options });
  }

  // An insecure origin may not set a Secure cookie (RFC 6265bis, "Leave
  // Secure Cookies Alone"). Secure means https or wss, as it does for the
  // cookies the jar sends.
  setCookie(cookie, url, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }

    let parsed = cookie;

    if (typeof cookie === "string") {
      parsed = toughCookie.Cookie.parse(cookie, { loose: true });
    }

    let secureOrigin = false;

    try {
      const { protocol } = new URL(String(url));
      secureOrigin = protocol === "https:" || protocol === "wss:";
    } catch {
      secureOrigin = false;
    }

    // Cookie name prefixes, matched without regard to case (RFC 6265bis):
    // __Secure- needs Secure; __Host- needs Secure, no Domain and Path=/.
    const name = parsed && typeof parsed.key === "string" ? parsed.key.toLowerCase() : "";
    const prefixUnmet = parsed &&
      ((name.startsWith("__secure-") && !parsed.secure) ||
        (name.startsWith("__host-") && (!parsed.secure || parsed.domain || parsed.path !== "/")));

    if (parsed && ((parsed.secure && !secureOrigin) || prefixUnmet)) {
      const error = new Error(prefixUnmet ?
        "A cookie does not meet the conditions of its name's prefix" :
        "A Secure cookie cannot be set from an insecure origin");

      if (options && options.ignoreError) {
        return callback ? callback(null, undefined) : Promise.resolve(undefined);
      }

      return callback ? callback(error) : Promise.reject(error);
    }

    return super.setCookie(cookie, url, options, callback);
  }
}

const window = Symbol("window");
let sharedFragmentDocument = null;

class JSDOM {
  constructor(input = "", options = {}) {
    const mimeType = new MIMEType(options.contentType === undefined ? "text/html" : options.contentType);
    const { html, encoding } = normalizeHTML(input, mimeType);

    options = transformOptions(options, encoding, mimeType);

    this[window] = createWindow(options.windowOptions);

    const documentImpl = idlUtils.implForWrapper(this[window]._document);

    options.beforeParse(this[window]._globalProxy);

    parseIntoLoadingDocument(html, documentImpl, () => documentImpl.close());
  }

  get window() {
    // It's important to grab the global proxy, instead of just the result of `createWindow(...)`, since otherwise
    // things like `window.eval` don't exist.
    return this[window]._globalProxy;
  }

  get virtualConsole() {
    return this[window]._virtualConsole;
  }

  get cookieJar() {
    // TODO NEWAPI move _cookieJar to window probably
    return idlUtils.implForWrapper(this[window]._document)._cookieJar;
  }

  serialize() {
    return fragmentSerialization(idlUtils.implForWrapper(this[window]._document), { requireWellFormed: false });
  }

  nodeLocation(node) {
    if (!idlUtils.implForWrapper(this[window]._document)._parseOptions.sourceCodeLocationInfo) {
      throw new Error("Location information was not saved for this jsdom. Use includeNodeLocations during creation.");
    }

    return idlUtils.implForWrapper(node).sourceCodeLocation;
  }

  getInternalVMContext() {
    if (!vm.isContext(this[window])) {
      throw new TypeError("This jsdom was not configured to allow script running. " +
        "Use the runScripts option during creation.");
    }

    return this[window];
  }

  reconfigure(settings) {
    if ("windowTop" in settings) {
      this[window]._top = settings.windowTop;
    }

    if ("url" in settings) {
      const document = idlUtils.implForWrapper(this[window]._document);

      const url = whatwgURL.parseURL(settings.url);
      if (url === null) {
        throw new TypeError(`Could not parse "${settings.url}" as a URL`);
      }

      document._URL = url;
      document._origin = whatwgURL.serializeURLOrigin(document._URL);
      this[window]._sessionHistory.currentEntry.url = url;
    }
  }

  static fragment(string = "") {
    if (!sharedFragmentDocument) {
      sharedFragmentDocument = (new JSDOM()).window.document;
    }

    const template = sharedFragmentDocument.createElement("template");
    template.innerHTML = string;
    return template.content;
  }

  static fromURL(url, options = {}) {
    return Promise.resolve().then(() => {
      // Remove the hash while sending this through the research loader fetch().
      // It gets added back a few lines down when constructing the JSDOM object.
      const parsedURL = new URL(url);
      const originalHash = parsedURL.hash;
      parsedURL.hash = "";
      url = parsedURL.href;

      options = normalizeFromURLOptions(options);

      const resourceLoader = resourcesToResourceLoader(options.resources);
      const resourceLoaderForInitialRequest = resourceLoader.constructor === NoOpResourceLoader ?
        new ResourceLoader() :
        resourceLoader;

      const req = resourceLoaderForInitialRequest.fetch(url, {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        cookieJar: options.cookieJar,
        referrer: options.referrer, 
        additionalHeaders: options.navigationOptions?.headers, 
        method: options.navigationOptions?.method ?? "GET",
        body: options.navigationOptions?.body
      });

      return req.then(body => {
        const res = req.response;
        const contentType = res.headers["content-type"];

        // A browser shows a document it has no layout for as text rather than
        // refusing it. Anything that is not HTML or XML is rejected below with
        // a RangeError, so submitting a form to an endpoint that answers JSON —
        // which is most of them — ended on an error panel instead of on the
        // response. The body is wrapped as preformatted text, which is what a
        // browser does with text/plain, and the document then behaves normally.
        const essence = String(contentType || "").split(";")[0].trim().toLowerCase();
        const isMarkup = essence === "text/html" || essence === "application/xhtml+xml" ||
          essence === "text/xml" || essence === "application/xml" || essence.endsWith("+xml");
        const isText = essence.startsWith("text/") || essence.endsWith("+json") ||
          /^application\/(json|javascript|ecmascript|x-javascript)$/.test(essence);

        if (!isMarkup && isText) {
          const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
          const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

          options = Object.assign(options, {
            url: req.href + originalHash,
            contentType: "text/html",
            referrer: req.getHeader("referer") ?? undefined
          });

          return new JSDOM(`<!DOCTYPE html><html><head></head><body><pre>${escaped}</pre></body></html>`, options);
        }

        // An image is shown as a document holding it, as a browser does when a
        // link leads straight to one. The image is the bytes already fetched,
        // so it is not requested a second time.
        // An SVG image is an XML document of its own, scripts and all, and is
        // loaded as one below.
        if (essence.startsWith("image/") && !isMarkup) {
          const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
          const name = decodeURIComponent(new URL(req.href).pathname.split("/").pop() || "") ||
            new URL(req.href).host;
          const escapedName = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");

          options = Object.assign(options, {
            url: req.href + originalHash,
            contentType: "text/html",
            referrer: req.getHeader("referer") ?? undefined
          });

          return new JSDOM(
            `<!DOCTYPE html><html><head><title>${escapedName}</title></head>` +
            `<body style="margin: 0; height: 100%"><img style="display: block; margin: auto" ` +
            `src="data:${essence};base64,${bytes.toString("base64")}"></body></html>`,
            options
          );
        }

        options = Object.assign(options, {
          url: req.href + originalHash,
          contentType,
          referrer: req.getHeader("referer") ?? undefined
        });

        return new JSDOM(body, options);
      });
    });
  }

  static async fromFile(filename, options = {}) {
    options = normalizeFromFileOptions(filename, options);
    const buffer = await fs.readFile(filename);

    return new JSDOM(buffer, options);
  }
}

function normalizeFromURLOptions(options) {
  // Checks on options that are invalid for `fromURL`
  if (options.url !== undefined) {
    throw new TypeError("Cannot supply a url option when using fromURL");
  }
  if (options.contentType !== undefined) {
    throw new TypeError("Cannot supply a contentType option when using fromURL");
  }

  // Normalization of options which must be done before the rest of the fromURL code can use them, because they are
  // given to request()
  const normalized = { ...options };

  if (options.referrer !== undefined) {
    normalized.referrer = (new URL(options.referrer)).href;
  }

  if (options.cookieJar === undefined) {
    normalized.cookieJar = new CookieJar();
  }

  return normalized;

  // All other options don't need to be processed yet, and can be taken care of in the normal course of things when
  // `fromURL` calls `new JSDOM(html, options)`.
}

function normalizeFromFileOptions(filename, options) {
  const normalized = { ...options };

  if (normalized.contentType === undefined) {
    const extname = path.extname(filename);
    if (extname === ".xhtml" || extname === ".xht" || extname === ".xml") {
      normalized.contentType = "application/xhtml+xml";
    }
  }

  if (normalized.url === undefined) {
    normalized.url = new URL("file:" + path.resolve(filename));
  }

  return normalized;
}

function transformOptions(options, encoding, mimeType) {
  const transformed = {
    windowOptions: {
      // Defaults
      url: "about:blank",
      referrer: "",
      contentType: "text/html",
      parsingMode: "html",
      parseOptions: {
        sourceCodeLocationInfo: false,
        scriptingEnabled: false
      },
      runScripts: undefined,
      encoding,
      pretendToBeVisual: false,
      storageQuota: 5000000,

      // Defaults filled in later
      resourceLoader: undefined,
      virtualConsole: undefined,
      cookieJar: undefined
    },

    // Defaults
    beforeParse() { }
  };

  // options.contentType was parsed into mimeType by the caller.
  if (!mimeType.isHTML() && !mimeType.isXML()) {
    throw new RangeError(`The given content type of "${options.contentType}" was not a HTML or XML content type`);
  }

  transformed.windowOptions.contentType = mimeType.essence;
  transformed.windowOptions.parsingMode = mimeType.isHTML() ? "html" : "xml";

  if (options.url !== undefined) {
    transformed.windowOptions.url = (new URL(options.url)).href;
  }

  if (options.referrer !== undefined) {
    transformed.windowOptions.referrer = (new URL(options.referrer)).href;
  }

  if (options.includeNodeLocations) {
    if (transformed.windowOptions.parsingMode === "xml") {
      throw new TypeError("Cannot set includeNodeLocations to true with an XML content type");
    }

    transformed.windowOptions.parseOptions = { sourceCodeLocationInfo: true };
  }

  transformed.windowOptions.cookieJar = options.cookieJar === undefined ?
                                       new CookieJar() :
                                       options.cookieJar;

  transformed.windowOptions.virtualConsole = options.virtualConsole === undefined ?
                                            (new VirtualConsole()).sendTo(console) :
                                            options.virtualConsole;

  if (!(transformed.windowOptions.virtualConsole instanceof VirtualConsole)) {
    throw new TypeError("virtualConsole must be an instance of VirtualConsole");
  }

  transformed.windowOptions.resourceLoader = resourcesToResourceLoader(options.resources);

  if (options.runScripts !== undefined) {
    transformed.windowOptions.runScripts = String(options.runScripts);
    if (transformed.windowOptions.runScripts === "dangerously") {
      transformed.windowOptions.parseOptions.scriptingEnabled = true;
    } else if (transformed.windowOptions.runScripts !== "outside-only") {
      throw new RangeError(`runScripts must be undefined, "dangerously", or "outside-only"`);
    }
  }

  if (options.beforeParse !== undefined) {
    transformed.beforeParse = options.beforeParse;
  }

  // The origin an about:blank document takes from the document that created
  // it, as a popup's initial document does from its opener. Without it the
  // document is given an opaque origin of its own.
  if (options.parentOrigin !== undefined) {
    transformed.windowOptions.parentOrigin = String(options.parentOrigin);
  }

  if (options.pretendToBeVisual !== undefined) {
    transformed.windowOptions.pretendToBeVisual = Boolean(options.pretendToBeVisual);
  }

  if (options.storageQuota !== undefined) {
    transformed.windowOptions.storageQuota = Number(options.storageQuota);
  }

  return transformed;
}

function normalizeHTML(html, mimeType) {
  let encoding = "UTF-8";

  if (ArrayBuffer.isView(html)) {
    html = Buffer.from(html.buffer, html.byteOffset, html.byteLength);
  } else if (html instanceof ArrayBuffer) {
    html = Buffer.from(html);
  }

  if (Buffer.isBuffer(html)) {
    encoding = sniffHTMLEncoding(html, {
      defaultEncoding: mimeType.isXML() ? "UTF-8" : "windows-1252",
      transportLayerEncodingLabel: mimeType.parameters.get("charset")
    });
    html = decodeBytes(html, encoding);
  } else {
    html = String(html);
  }

  return { html, encoding };
}

function resourcesToResourceLoader(resources) {
  switch (resources) {
    case undefined: {
      return new NoOpResourceLoader();
    }
    case "usable": {
      return new ResourceLoader();
    }
    default: {
      if (!(resources instanceof ResourceLoader)) {
        throw new TypeError("resources must be an instance of ResourceLoader");
      }
      return resources;
    }
  }
}

exports.JSDOM = JSDOM;

exports.VirtualConsole = VirtualConsole;
exports.CookieJar = CookieJar;
exports.ResourceLoader = ResourceLoader;

exports.toughCookie = toughCookie;
exports.implSymbol = utils.implSymbol;
// The way back from an implementation object to its wrapper, which is what a
// host application's own bookkeeping on DOM nodes is keyed by.
exports.wrapperSymbol = utils.wrapperSymbol;

// The bytes and type a blob URL names, or null: for a host application's own
// resource loader, which has to answer blob URLs without a request.
exports.resolveBlobURL = require("./jsdom/living/file-api/blob-url-store").resolveBlobURL;

// Lets the host application decode a document's images itself rather than
// through the environment's decoders. See living/helpers/image-decoding.js.
exports.setImageDecoder = require("./jsdom/living/helpers/image-decoding").setImageDecoder;

// Lets the host application supply crypto.subtle, which this library does not
// implement. See living/helpers/subtle-crypto.js.
exports.setSubtleCrypto = require("./jsdom/living/helpers/subtle-crypto").setSubtleCrypto;

// Lets the host application carry a request itself, rather than through the
// environment's network. See living/helpers/request-transport.js.
exports.setRequestTransport = require("./jsdom/living/helpers/request-transport").setRequestTransport;

// Lets the host application refuse a request before it is sent, by any rule of
// its own. See living/helpers/request-policy.js.
exports.setRequestPolicy = require("./jsdom/living/helpers/request-policy").setRequestPolicy;

// Lets the host application supply the Streams interfaces, which a response
// body is otherwise not one of. See living/helpers/streams.js.
exports.setStreams = require("./jsdom/living/helpers/streams").setStreams;

// Lets the host application answer the box metrics with a layout it computed
// itself; without it they are all zero, this library laying nothing out. See
// living/helpers/layout-geometry.js.
exports.setLayoutGeometry = require("./jsdom/living/helpers/layout-geometry").setLayoutGeometry;

// Lets the host application answer elementFromPoint() and elementsFromPoint() from what it painted; without it
// they find nothing, this library painting nothing. See living/helpers/hit-testing.js.
exports.setHitTest = require("./jsdom/living/helpers/hit-testing").setHitTest;

// Lets the host application install what it supplies on a frame's window, as
// it does on a top-level one. See living/helpers/frame-windows.js.
exports.setFrameWindowPreparer = require("./jsdom/living/helpers/frame-windows").setFrameWindowPreparer;

// Tells the host application of a change to how an element renders that no mutation record carries, such as a
// popover shown or hidden. See living/helpers/rendering-invalidation.js.
exports.setRenderingInvalidation = require("./jsdom/living/helpers/rendering-invalidation").setRenderingInvalidation;

// Lets the host application run module scripts, which this library drops. See
// living/helpers/module-scripts.js.
exports.setModuleEvaluator = require("./jsdom/living/helpers/module-scripts").setModuleEvaluator;

// Fetches a module's source for a window the way its module scripts are fetched, so that the host application can
// load a graph a classic script asked for with import(), where there is no script element to fetch the entry.
exports.fetchModuleText = require("./jsdom/living/helpers/module-scripts").fetchModuleText;

// Makes the style sheet a CSS module script stands for, for the host application's module loader.
exports.createCSSModuleStyleSheet = require("./jsdom/living/helpers/stylesheets").createCSSModuleStyleSheet;
