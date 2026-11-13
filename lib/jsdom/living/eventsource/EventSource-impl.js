"use strict";

const { serializeURL, serializeURLOrigin, parseURL } = require("whatwg-url");
const MIMEType = require("whatwg-mimetype");

const DOMException = require("../generated/DOMException");
const MessageEvent = require("../generated/MessageEvent");
const idlUtils = require("../generated/utils");
const EventTargetImpl = require("../events/EventTarget-impl").implementation;
const { setupForSimpleEventAccessors } = require("../helpers/create-event-accessor");
const { fireAnEvent } = require("../helpers/events");
const { parseURLToResultingURLRecord } = require("../helpers/document-base-url");

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

// The reconnection time a stream starts with, which its retry field replaces.
// The standard leaves it to the user agent; this is Chromium's.
const DEFAULT_RECONNECTION_TIME = 3000;

const LF = 0x0A;
const CR = 0x0D;

// https://html.spec.whatwg.org/multipage/server-sent-events.html
//
// The request goes out on fetch's own path (fetch/fetch-impl.js), the one
// fetch() and XMLHttpRequest take: the same CORS protocol, cookies, referrer
// and fetch metadata, and the same transport the host application carries
// those on. The body is read as it arrives, an event dispatched as soon as the
// blank line ending it has been read.
class EventSourceImpl extends EventTargetImpl {
  constructor(globalObject, [url, eventSourceInitDict]) {
    super(globalObject);

    this._ownerDocument = idlUtils.implForWrapper(globalObject._document);

    const urlRecord = parseURLToResultingURLRecord(url, this._ownerDocument);

    if (urlRecord === null) {
      throw DOMException.create(globalObject, [`The URL '${url}' is invalid.`, "SyntaxError"]);
    }

    this.url = serializeURL(urlRecord);
    this.withCredentials = Boolean(eventSourceInitDict && eventSourceInitDict.withCredentials);
    this.readyState = CONNECTING;

    this._reconnectionTime = DEFAULT_RECONNECTION_TIME;
    this._lastEventId = "";
    this._stream = null;
    this._reconnectTimer = null;

    // Held by the document's request manager for as long as the source may
    // still connect. The manager aborts what it holds when the document stops
    // loading or goes, whether a request is in flight or a reconnection is
    // waiting, and an aborted fetch fails the connection.
    this._managed = { abort: () => this._abortFetch() };
    if (this._ownerDocument._requestManager) {
      this._ownerDocument._requestManager.add(this._managed);
    }

    this._connect();
  }

  close() {
    this._close();
  }

  _close() {
    this.readyState = CLOSED;

    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._stream) {
      this._stream.cancel();
      this._stream = null;
    }

    if (this._ownerDocument._requestManager) {
      this._ownerDocument._requestManager.remove(this._managed);
    }
  }

  _abortFetch() {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._stream) {
      this._stream.cancel();
    }

    if (this.readyState !== CLOSED) {
      this._fail();
    }
  }

  _queueTask(steps) {
    setTimeout(steps, 0);
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#dom-eventsource
  // steps 6 to 14, and the reestablishing of a connection.
  _connect() {
    const globalObject = this._globalObject;
    const request = new globalObject.Request(this.url, {
      mode: "cors",
      credentials: this.withCredentials ? "include" : "same-origin",
      cache: "no-store",
      headers: { Accept: "text/event-stream" }
    });

    // A browser sends the stream's last event ID on its reconnections without
    // asking a cross-origin site's leave first.
    const exempt = [];
    if (this._lastEventId !== "") {
      exempt.push(["Last-Event-ID", Buffer.from(this._lastEventId, "utf8").toString("latin1")]);
    }

    const stream = new EventStream(this);
    stream.sink.corsExemptHeaders = exempt;
    this._stream = stream;

    // Required here: fetch-impl reaches Response-impl, which is still being
    // defined while the interfaces load this file.
    const { _fetch } = require("../fetch/fetch-impl");

    _fetch(
      request,
      globalObject,
      null,
      null,
      null,
      response => stream.processResponse(response),
      null,
      null,
      false,
      stream.sink
    );
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#announce-the-connection
  _announce() {
    this._queueTask(() => {
      if (this.readyState !== CLOSED) {
        this.readyState = OPEN;
        fireAnEvent("open", this);
      }
    });
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#reestablish-the-connection
  _reestablish() {
    this._stream = null;

    this._queueTask(() => {
      if (this.readyState === CLOSED) {
        return;
      }

      this.readyState = CONNECTING;
      fireAnEvent("error", this);

      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;

        if (this.readyState === CONNECTING) {
          this._connect();
        }
      }, this._reconnectionTime);
    });
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#fail-the-connection
  _fail() {
    this._stream = null;

    this._queueTask(() => {
      if (this.readyState !== CLOSED) {
        this._close();
        fireAnEvent("error", this);
      }
    });
  }
}

// One connection's response: its validation, and its body interpreted line
// by line (https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).
class EventStream {
  constructor(source) {
    this.source = source;
    this.cancelled = false;
    this.accepted = false;
    this.ended = false;
    this.pending = [];
    this.origin = "null";

    this.decoder = new TextDecoder("utf-8");
    this.line = "";
    this.afterCR = false;

    this.data = "";
    this.eventType = "";
    this.lastEventIdBuffer = source._lastEventId;

    this.sink = {
      abort: null,
      corsExemptHeaders: [],
      networkFailure: false,
      onData: chunk => this._receive({ chunk }),
      onEnd: () => this._receive({ end: true }),
      // An aborted fetch fails the connection; any other error ends the
      // response, and the connection is made again.
      onError: error => this._receive({ end: true, aborted: Boolean(error && error.name === "AbortError") })
    };
  }

  cancel() {
    this.cancelled = true;
    if (this.sink.abort) {
      this.sink.abort();
    }
  }

  processResponse(response) {
    if (this.cancelled) {
      return;
    }

    const { source } = this;
    const impl = response[idlUtils.implSymbol];

    if (response.type === "error") {
      this.cancel();

      // A request that could not be made is tried again; one the CORS protocol
      // or a redirect refused would be refused again.
      if (this.sink.networkFailure) {
        source._reestablish();
      } else {
        source._fail();
      }
      return;
    }

    const contentType = response.headers.get("content-type");
    const mimeType = contentType === null ? null : MIMEType.parse(contentType);

    if (response.status !== 200 || mimeType === null || mimeType.essence !== "text/event-stream") {
      this.cancel();
      source._fail();
      return;
    }

    const urlList = impl._urlList || [];
    const finalURL = parseURL(impl._url || urlList[urlList.length - 1] || source.url);
    this.origin = finalURL ? serializeURLOrigin(finalURL) : "null";

    source._announce();

    this.accepted = true;

    // A response answered without the network (a blob: URL) arrives whole.
    if (!this.sink.abort) {
      if (impl._bodyBuffer && impl._bodyBuffer.length) {
        this.pending.push({ chunk: impl._bodyBuffer });
      }
      this.pending.push({ end: true });
    }

    const queued = this.pending;
    this.pending = [];
    for (const item of queued) {
      this._receive(item);
    }
  }

  _receive(item) {
    if (this.cancelled || this.ended) {
      return;
    }

    if (!this.accepted) {
      this.pending.push(item);
      return;
    }

    if (item.chunk) {
      this._parse(this.decoder.decode(item.chunk, { stream: true }));
    }

    if (item.end) {
      this.ended = true;
      this._parse(this.decoder.decode());
      // Whatever an unterminated event had gathered is discarded.
      if (item.aborted) {
        this.source._fail();
      } else {
        this.source._reestablish();
      }
    }
  }

  _parse(text) {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);

      if (code === LF) {
        if (this.afterCR) {
          this.afterCR = false;
          continue;
        }
        this._processLine(this.line);
        this.line = "";
      } else if (code === CR) {
        this.afterCR = true;
        this._processLine(this.line);
        this.line = "";
      } else {
        this.afterCR = false;
        this.line += text[i];
      }
    }
  }

  _processLine(line) {
    if (line === "") {
      this._dispatch();
      return;
    }

    if (line[0] === ":") {
      return;
    }

    const colon = line.indexOf(":");
    let field = line;
    let value = "";

    if (colon !== -1) {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value[0] === " ") {
        value = value.slice(1);
      }
    }

    switch (field) {
      case "event":
        this.eventType = value;
        break;
      case "data":
        this.data += value + "\n";
        break;
      case "id":
        if (!value.includes("\u0000")) {
          this.lastEventIdBuffer = value;
        }
        break;
      case "retry":
        if (/^[0-9]+$/.test(value)) {
          this.source._reconnectionTime = Number.parseInt(value, 10);
        }
        break;
      default:
        break;
    }
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#dispatchMessage
  _dispatch() {
    const { source } = this;

    source._lastEventId = this.lastEventIdBuffer;

    if (this.data === "") {
      this.eventType = "";
      return;
    }

    const data = this.data.endsWith("\n") ? this.data.slice(0, -1) : this.data;
    const type = this.eventType === "" ? "message" : this.eventType;
    const lastEventId = source._lastEventId;
    const { origin } = this;

    this.data = "";
    this.eventType = "";

    source._queueTask(() => {
      if (source.readyState !== CLOSED && !this.cancelled) {
        fireAnEvent(type, source, MessageEvent, { data, origin, lastEventId });
      }
    });
  }
}

setupForSimpleEventAccessors(EventSourceImpl.prototype, ["open", "message", "error"]);

module.exports = {
  implementation: EventSourceImpl
};
