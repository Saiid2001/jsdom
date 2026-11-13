"use strict";
const idlUtils = require("../../living/generated/utils");
const { fireAnEvent } = require("../../living/helpers/events");
const referrerPolicy = require("../../living/helpers/referrer-policy");

module.exports = class PerDocumentResourceLoader {
  constructor(document) {
    this._document = document;
    this._defaultEncoding = document._encoding;
    this._resourceLoader = document._defaultView ? document._defaultView._resourceLoader : null;
    this._requestManager = document._requestManager;
    this._queue = document._queue;
    this._deferQueue = document._deferQueue;
    this._asyncQueue = document._asyncQueue;

    // Requests the element that made them has given up on: they settle
    // without firing an event, and no longer hold up the load event.
    this._canceled = new WeakSet();
  }

  /** Gives up on a request this loader made, without aborting what may be shared. */
  cancel(request) {
    if (!request || this._canceled.has(request)) {
      return;
    }

    this._canceled.add(request);
    this._requestManager.remove(request);
    this._asyncQueue.forget(request);
  }

  // `referrer` and `referrerPolicy` name a request made on behalf of something
  // other than the element: a style sheet's @import is made from that sheet.
  // Otherwise the request's referrer is the document, and its policy the
  // element's referrerpolicy, else the document's.
  fetch(url, { element, onLoad, onError, referrer, referrerPolicy: policy }) {
    const request = this._resourceLoader.fetch(url, {
      cookieJar: this._document._cookieJar,
      element: idlUtils.wrapperForImpl(element),
      referrer: referrer ?? this._document.URL,
      // The document, which the referrer is not where a style sheet makes
      // the request: what fetch metadata describes the request as coming from.
      client: this._document.URL,
      referrerPolicy: policy ?? referrerPolicy.requestPolicy(element, this._document)
    });

    if (request === null) {
      return null;
    }

    this._requestManager.add(request);

    const onErrorWrapped = error => {
      this._requestManager.remove(request);

      if (this._canceled.has(request)) {
        return Promise.resolve();
      }

      if (onError) {
        onError(error);
      }

      fireAnEvent("error", element);

      const err = new Error(`Could not load ${element.localName}: "${url}"`);
      err.type = "resource loading";
      err.detail = error;

      this._document._defaultView._virtualConsole.emit("jsdomError", err);

      return Promise.resolve();
    };

    const onLoadWrapped = data => {
      this._requestManager.remove(request);

      if (this._canceled.has(request)) {
        return Promise.resolve();
      }

      this._addCookies(url, request.response ? request.response.headers : {});

      // A response that is not ok is a failed fetch for every subresource an
      // element loads. jsdom's own loader rejects one before it reaches here;
      // a loader that resolves with whatever the server sent does not, and a
      // stylesheet answered 404 would otherwise apply its body and fire load.
      const statusCode = request.response ? request.response.statusCode : undefined;

      if (typeof statusCode === "number" && (statusCode < 200 || statusCode > 299)) {
        return onErrorWrapped(new Error(`Resource was not loaded. Status: ${statusCode}`));
      }

      try {
        const result = onLoad ? onLoad(data) : undefined;

        return Promise.resolve(result)
          .then(() => {
            fireAnEvent("load", element);

            return Promise.resolve();
          })
          .catch(err => {
            return onErrorWrapped(err);
          });
      } catch (err) {
        return onErrorWrapped(err);
      }
    };

    // An image delays the load event and nothing else: a script after it and
    // DOMContentLoaded do not wait for it, so it is not in the ordered queue
    // they are. The async queue is the one the load event waits on alone.
    if (element.localName === "img") {
      this._asyncQueue.push(request, onLoadWrapped, onErrorWrapped, null);
    } else if (element.localName === "script" && (element.hasAttributeNS(null, "async") ||
        (!element._parserInserted && element._nonBlocking))) {
      // https://html.spec.whatwg.org/multipage/scripting.html#set-of-scripts-that-will-execute-as-soon-as-possible
      this._asyncQueue.push(request, onLoadWrapped, onErrorWrapped, null);
    } else if (element.localName === "script" && !element._parserInserted) {
      // https://html.spec.whatwg.org/multipage/scripting.html#list-of-scripts-that-will-execute-in-order-as-soon-as-possible
      this._asyncQueue.pushInOrder(request, onLoadWrapped, onErrorWrapped);
    } else if (
      element.localName === "script" &&
        element.hasAttributeNS(null, "defer") &&
        this._document.readyState !== "interactive") {
      this._deferQueue.push(request, onLoadWrapped, onErrorWrapped, false, element);
    } else {
      this._queue.push(request, onLoadWrapped, onErrorWrapped, false, element);
    }

    return request;
  }

  _addCookies(url, headers) {
    let cookies = headers["set-cookie"];

    if (!cookies) {
      return;
    }

    if (!Array.isArray(cookies)) {
      cookies = [cookies];
    }

    cookies.forEach(cookie => {
      this._document._cookieJar.setCookieSync(cookie, url, { http: true, ignoreError: true });
    });
  }
};
