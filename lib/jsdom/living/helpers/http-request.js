"use strict";
const http = require("http");
const https = require("https");
const requestTransport = require("./request-transport");
const proxyUtils = require("./proxy-utils");
const referrerPolicy = require("./referrer-policy");
const { Writable } = require("stream");
const zlib = require("zlib");

const ver = process.version.replace("v", "").split(".");
const majorNodeVersion = Number.parseInt(ver[0]);

function abortRequest(clientRequest) {
  clientRequest.destroy();
  clientRequest.removeAllListeners();
  clientRequest.on("error", () => {});
}

module.exports = class Request extends Writable {
  constructor(url, clientOptions, requestOptions) {
    super();
    Object.assign(this, clientOptions);
    this.currentURL = url;
    this._requestOptions = requestOptions;
    this.headers = requestOptions.headers;
    this._ended = false;
    this._redirectCount = 0;
    this._requestBodyBuffers = [];
    this._bufferIndex = 0;
    this._performRequest();
  }

  abort() {
    abortRequest(this._currentRequest);
    this.emit("abort");
    this.removeAllListeners();
  }

  pipeRequest(form) {
    form.pipe(this._currentRequest);
  }

  write(data, encoding) {
    if (data.length > 0) {
      this._requestBodyBuffers.push({ data, encoding });
      this._currentRequest.write(data, encoding);
    }
  }

  end() {
    this.emit("request", this._currentRequest);
    this._ended = true;
    this._currentRequest.end();
  }

  setHeader(name, value) {
    this.headers[name] = value;
    this._currentRequest.setHeader(name, value);
  }

  removeHeader(name) {
    delete this.headers[name];
    this._currentRequest.removeHeader(name);
  }

  // Without this method, the test send-redirect-infinite-sync will halt the test suite
  // TODO: investigate this further and ideally remove
  toJSON() {
    const { method, headers } = this._requestOptions;
    return { uri: new URL(this.currentURL), method, headers };
  }

  _writeNext(error) {
    if (this._currentRequest) {
      if (error) {
        this.emit("error", error);
      } else if (this._bufferIndex < this._requestBodyBuffers.length) {
        const buffer = this._requestBodyBuffers[this._bufferIndex++];
        if (!this._currentRequest.writableEnded) {
          this._currentRequest.write(
            buffer.data,
            buffer.encoding,
            this._writeNext.bind(this)
          );
        }
      } else if (this._ended) {
        this._currentRequest.end();
      }
    }
  }

  // The address a request goes out to. Through a proxy (`proxyUrl`), that is
  // the proxy's, with the site in BSBX-PROXY-HOST; currentURL stays the
  // site's, so cookies, redirects and Referer are all about the site.
  _wireURL() {
    if (!this.proxyUrl) {
      return this.currentURL;
    }

    this.headers["BSBX-PROXY-HOST"] = new URL(this.currentURL).origin;

    return proxyUtils.translateUrlForProxy(this.currentURL, this.proxyUrl);
  }

  // The address a response came from: the site's, or the one the proxy
  // states it ended at when it followed redirects itself.
  _responseURL(response) {
    if (!this.proxyUrl) {
      return this.currentURL;
    }

    const stated = response.headers["bsbx-proxy-host"];

    if (!stated) {
      return this.currentURL;
    }

    return proxyUtils.restoreOriginalUrl(this._wire, this.proxyUrl, () => stated);
  }

  _performRequest() {
    this._wire = this._wireURL();
    const urlOptions = new URL(this._wire);
    const scheme = urlOptions.protocol;

    // browserify's (http|https).request() does not work correctly with the (url, options, callback) signature. Instead
    // we need to have options for each of the URL components. Note that we can't use the spread operator because URL
    // instances don't have own properties for the URL components.
    const requestOptions = {
      ...this._requestOptions,
      agent: this.agents[scheme.substring(0, scheme.length - 1)],
      protocol: urlOptions.protocol,
      hostname: urlOptions.hostname,
      port: urlOptions.port,
      path: urlOptions.pathname + urlOptions.search
    };

    // The host application's transport first, where it has one for this
    // request -- see helpers/request-transport.js. Everything but the resource
    // loader reaches the network through here, so a host that carries requests
    // itself has no other place to be asked.
    const carried = requestTransport.openRequest(requestOptions, response => {
      this._processResponse(response);
    });

    if (carried) {
      this._currentRequest = carried;
    } else {
      const { request } = scheme === "https:" ? https : http;

      this._currentRequest = request(requestOptions, response => {
        this._processResponse(response);
      });
    }

    let cookies;
    if (this._redirectCount === 0) {
      this.originalCookieHeader = this.getHeader("Cookie");
    }
    if (this.cookieJar) {
      cookies = this.cookieJar.getCookieStringSync(this._cookieURL());
    }
    if (cookies && cookies.length) {
      if (this.originalCookieHeader) {
        this.setHeader("Cookie", this.originalCookieHeader + "; " + cookies);
      } else {
        this.setHeader("Cookie", cookies);
      }
    }

    for (const event of ["connect", "error", "socket", "timeout"]) {
      this._currentRequest.on(event, (...args) => {
        this.emit(event, ...args);
      });
    }
    if (this._isRedirect) {
      this._bufferIndex = 0;
      this._writeNext();
    }
  }

  _processResponse(response) {
    const cookies = response.headers["set-cookie"];
    if (this.cookieJar && Array.isArray(cookies)) {
      try {
        cookies.forEach(cookie => {
          this.cookieJar.setCookieSync(cookie, this._cookieURL(response), { ignoreError: true });
        });
      } catch (e) {
        this.emit("error", e);
      }
    }

    const { statusCode } = response;
    const { location } = response.headers;
    // In Node v15, aborting a message with remaining data causes an error to be thrown,
    // hence the version check
    const catchResErrors = err => {
      if (!(majorNodeVersion >= 15 && err.message === "aborted")) {
        this.emit("error", err);
      }
    };
    response.on("error", catchResErrors);
    let redirectAddress = null;
    let resendWithAuth = false;
    if (typeof location === "string" &&
      location.length &&
      this.followRedirects &&
      // https://fetch.spec.whatwg.org/#redirect-status
      [301, 302, 303, 307, 308].includes(statusCode)) {
      redirectAddress = location;
    } else if (statusCode === 401 &&
      /^Basic /i.test(response.headers["www-authenticate"] || "") &&
      (this.user && this.user.length)) {
      this._requestOptions.auth = `${this.user}:${this.pass}`;
      resendWithAuth = true;
    }
    if (redirectAddress || resendWithAuth) {
      if (++this._redirectCount > 21) {
        const redirectError = new Error("Maximum number of redirects exceeded");
        redirectError.code = "ERR_TOO_MANY_REDIRECTS";
        this.emit("error", redirectError);
        return;
      }
      abortRequest(this._currentRequest);
      response.destroy();
      this._isRedirect = true;
      if (((statusCode === 301 || statusCode === 302) && this._requestOptions.method === "POST") ||
        (statusCode === 303 && !/^(?:GET|HEAD)$/.test(this._requestOptions.method))) {
        this._requestOptions.method = "GET";
        this._requestBodyBuffers = [];
        // The body is gone, and so is what described it
        // (https://fetch.spec.whatwg.org/#http-redirect-fetch, step 12).
        this._removeMatchingHeaders(/^content-(type|length|encoding|language|location)$/i);
      }
      let previousHostName = this._removeMatchingHeaders(/^host$/i);
      if (!previousHostName) {
        previousHostName = new URL(this.currentURL).hostname;
      }
      const previousURL = this.currentURL;
      if (!resendWithAuth) {
        let nextURL;
        try {
          nextURL = new URL(redirectAddress, this.currentURL);
        } catch (e) {
          this.emit("error", e);
          return;
        }

        // A redirect to anything but http(s) is a network error.
        if (nextURL.protocol !== "http:" && nextURL.protocol !== "https:") {
          this.emit("error", new Error(`A redirect to ${nextURL.protocol} is not followed`));
          return;
        }

        if (nextURL.hostname !== previousHostName) {
          this._removeMatchingHeaders(/^authorization$/i);
        }
        this.currentURL = nextURL.toString();
      }
      if (this.referrerFor) {
        // The request's referrer, determined again for the new address under
        // the policy a redirect may state (Referrer-Policy on the response).
        const stated = referrerPolicy.parsePolicy(response.headers["referrer-policy"]);

        if (stated) {
          this._referrerPolicy = stated;
        }

        // The previous request's referrer is this one's source: once reduced
        // to an origin, or to none, it is never restored by a later hop.
        const previous = this._removeMatchingHeaders(/^referer$/i) || null;
        const referrer = this.referrerFor(this.currentURL, this._referrerPolicy, previous);

        if (referrer) {
          this.headers.Referer = referrer;
        }
      } else {
        this.headers.Referer = previousURL;
      }
      this.emit("redirect", response, this.headers, this.currentURL, previousURL);
      try {
        this._performRequest();
      } catch (cause) {
        this.emit("error", cause);
      }
    } else {
      let pipeline = response;
      const acceptEncoding = this.headers["Accept-Encoding"];
      const requestCompressed = typeof acceptEncoding === "string" &&
        (acceptEncoding.includes("gzip") || acceptEncoding.includes("deflate"));
      if (
        requestCompressed &&
        this._requestOptions.method !== "HEAD" &&
        statusCode >= 200 &&
        statusCode !== 204 &&
        statusCode !== 304
      ) {
        // Browserify's zlib does not support zlib.constants.
        const zlibOptions = {
          flush: (zlib.constants ?? zlib).Z_SYNC_FLUSH,
          finishFlush: (zlib.constants ?? zlib).Z_SYNC_FLUSH
        };
        const contentEncoding = (response.headers["content-encoding"] || "identity").trim().toLowerCase();
        if (contentEncoding === "gzip") {
          pipeline = zlib.createGunzip(zlibOptions);
          response.pipe(pipeline);
        } else if (contentEncoding === "deflate") {
          pipeline = zlib.createInflate(zlibOptions);
          response.pipe(pipeline);
        }
      }
      pipeline.removeAllListeners("error");
      this.emit("response", response, this._responseURL(response));
      pipeline.on("data", bytes => this.emit("data", bytes));
      pipeline.once("end", bytes => this.emit("end", bytes));
      pipeline.on("error", catchResErrors);
      pipeline.on("close", () => this.emit("close"));
      this._requestBodyBuffers = [];
    }
  }

  // The address whose cookies a request sends and a response sets: the
  // site's, whichever way the request went.
  _cookieURL(response) {
    return response ? this._responseURL(response) : this.currentURL;
  }

  getHeader(key, value) {
    if (this._currentRequest) {
      return this._currentRequest.getHeader(key, value);
    }
    return null;
  }

  _removeMatchingHeaders(regex) {
    let lastValue;
    for (const header in this.headers) {
      if (regex.test(header)) {
        lastValue = this.headers[header];
        delete this.headers[header];
      }
    }
    return lastValue;
  }
};
