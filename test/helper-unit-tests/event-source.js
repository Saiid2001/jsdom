"use strict";
const assert = require("node:assert/strict");
const { describe, specify } = require("mocha-sugar-free");

const { JSDOM, ResourceLoader, VirtualConsole } = require("../../lib/api.js");
const { createServer } = require("../util.js");

// EventSource (https://html.spec.whatwg.org/multipage/server-sent-events.html),
// carried on the request path fetch and XMLHttpRequest use.

/**
 * A proxy answering as the site named in BSBX-PROXY-HOST. `routes` maps a path
 * to a handler given (req, res, url); every request is recorded in `seen`.
 */
async function site(routes) {
  const seen = [];
  const closed = [];
  const server = await createServer((req, res) => {
    const target = new URL(req.headers["bsbx-proxy-host"]);
    const url = new URL(req.url.replace(/^\/proxy/, ""), target.origin);
    const record = { method: req.method, url: url.href, headers: req.headers };

    seen.push(record);
    res.on("close", () => closed.push(record));

    const route = routes[url.pathname];

    if (!route) {
      res.writeHead(404, { "Content-Type": "text/plain", "BSBX-PROXY-HOST": url.href });
      res.end();
      return;
    }

    route(req, res, url);
  });

  class Loader extends ResourceLoader {
    constructor() {
      super();
      this.proxyUrl = `http://127.0.0.1:${server.address().port}/proxy`;
    }
  }

  const { window } = new JSDOM("", {
    url: "https://site.test/page",
    resources: new Loader(),
    virtualConsole: new VirtualConsole()
  });

  return { window, seen, closed, done: () => { window.close(); server.destroy(); } };
}

function stream(res, url, extra = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "BSBX-PROXY-HOST": url.href, ...extra });
}

function next(target, type) {
  return new Promise(resolve => target.addEventListener(type, resolve, { once: true }));
}

function waitFor(condition, ms = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - started > ms) {
        reject(new Error("timed out"));
      } else {
        setTimeout(poll, 5);
      }
    };
    poll();
  });
}

describe("Helpers: EventSource", () => {
  specify("is an interface of the window, with its attributes and constants", async () => {
    const { window, done } = await site({
      "/events": (req, res, url) => {
        stream(res, url);
      }
    });
    try {
      assert.equal(typeof window.EventSource, "function");
      assert.equal(window.EventSource.CONNECTING, 0);
      assert.equal(window.EventSource.OPEN, 1);
      assert.equal(window.EventSource.CLOSED, 2);

      const source = new window.EventSource("/events");
      assert.ok(source instanceof window.EventTarget);
      assert.equal(source.url, "https://site.test/events");
      assert.equal(source.withCredentials, false);
      assert.equal(source.readyState, window.EventSource.CONNECTING);
      source.close();
      assert.equal(source.readyState, window.EventSource.CLOSED);

      const credentialed = new window.EventSource("/events", { withCredentials: true });
      assert.equal(credentialed.withCredentials, true);
      credentialed.close();

      assert.throws(() => new window.EventSource("https://exa mple.test/"), error =>
        error instanceof window.DOMException && error.name === "SyntaxError");
    } finally {
      done();
    }
  });

  specify("dispatches each event as it arrives, while the response is still open", async () => {
    let response;
    const { window, done } = await site({
      "/events": (req, res, url) => {
        response = res;
        stream(res, url);
        res.write("data: one\n\n");
      }
    });
    try {
      const source = new window.EventSource("/events");
      const opened = next(source, "open");
      const first = next(source, "message");

      await opened;
      assert.equal(source.readyState, window.EventSource.OPEN);

      const one = await first;
      assert.ok(one instanceof window.MessageEvent);
      assert.equal(one.data, "one");
      assert.equal(one.origin, "https://site.test");
      assert.equal(one.isTrusted, true);

      const second = next(source, "message");
      response.write("data: two\n\n");
      assert.equal((await second).data, "two");
      source.close();
    } finally {
      done();
    }
  });

  specify("parses the event stream format", async () => {
    const { window, done } = await site({
      "/events": (req, res, url) => {
        stream(res, url);
        res.end(
          "﻿data: first\r\n" +
          ": a comment\r" +
          "data:second line\n\n" +
          "event: custom\ndata: named\nid: 42\n\n" +
          "data\n\n" +
          "unknown: field\ndata:  leading\n\n" +
          "id: 4\u00002\ndata: null id ignored\n\n" +
          "data: never dispatched"
        );
      }
    });
    try {
      const source = new window.EventSource("/events");
      const messages = [];
      const named = [];

      source.onmessage = event => messages.push([event.data, event.lastEventId]);
      source.addEventListener("custom", event => named.push([event.data, event.lastEventId, event.type]));

      await next(source, "error");
      source.close();

      assert.deepEqual(messages, [
        ["first\nsecond line", ""],
        ["", "42"],
        [" leading", "42"],
        ["null id ignored", "42"]
      ]);
      assert.deepEqual(named, [["named", "42", "custom"]]);
    } finally {
      done();
    }
  });

  specify("reads a line ending, a BOM or a character split between two chunks as one", async () => {
    const { window, done } = await site({
      "/events": (req, res, url) => {
        stream(res, url);
        const bytes = Buffer.from("﻿data: a\r\ndata: é\r\n\r\n", "utf8");
        const cuts = [1, 11, 19, bytes.length];
        let from = 0;
        const send = () => {
          const to = cuts.shift();
          res.write(bytes.subarray(from, to));
          from = to;
          if (cuts.length) {
            setTimeout(send, 20);
          }
        };
        send();
      }
    });
    try {
      const source = new window.EventSource("/events");
      const event = await next(source, "message");
      source.close();
      assert.equal(event.data, "a\né");
    } finally {
      done();
    }
  });

  specify("reconnects after the delay retry sets, sending Last-Event-ID", async () => {
    let count = 0;
    const { window, seen, done } = await site({
      "/events": (req, res, url) => {
        count++;
        stream(res, url);
        res.end(count === 1 ? "retry: 50\nid: 7\ndata: a\n\n" : "data: b\n\n");
      }
    });
    try {
      const source = new window.EventSource("/events");
      const data = [];
      const states = [];

      source.onmessage = event => data.push(event.data);
      source.onerror = () => states.push(source.readyState);

      await waitFor(() => data.length === 2);
      source.close();

      assert.deepEqual(data, ["a", "b"]);
      assert.equal(states[0], window.EventSource.CONNECTING);
      assert.equal(seen[0].headers["last-event-id"], undefined);
      assert.equal(seen[1].headers["last-event-id"], "7");
    } finally {
      done();
    }
  });

  specify("sends what a browser sends for an event stream", async () => {
    const { window, seen, done } = await site({
      "/events": (req, res, url) => {
        stream(res, url, { "Access-Control-Allow-Origin": req.headers.origin || "*" });
        res.end("retry: 20\nid: 1\ndata: x\n\n");
      }
    });
    try {
      const source = new window.EventSource("https://other.test/events");
      await next(source, "message");
      await waitFor(() => seen.length >= 2);
      source.close();

      assert.equal(seen[0].method, "GET");
      assert.equal(seen[0].headers.accept, "text/event-stream");
      assert.equal(seen[0].headers["cache-control"], "no-cache");
      assert.equal(seen[0].headers["sec-fetch-mode"], "cors");
      assert.equal(seen[0].headers["sec-fetch-dest"], "empty");
      assert.equal(seen[0].headers.origin, "https://site.test");
      // The reconnection carries Last-Event-ID and is still not preflighted.
      assert.equal(seen[1].method, "GET");
      assert.equal(seen[1].headers["last-event-id"], "1");
    } finally {
      done();
    }
  });

  specify("fails the connection on a type other than text/event-stream, or a status other than 200", async () => {
    const { window, seen, done } = await site({
      "/plain": (req, res, url) => {
        res.writeHead(200, { "Content-Type": "text/plain", "BSBX-PROXY-HOST": url.href });
        res.end("data: x\n\n");
      },
      "/missing": (req, res, url) => {
        res.writeHead(500, { "Content-Type": "text/event-stream", "BSBX-PROXY-HOST": url.href });
        res.end("data: x\n\n");
      }
    });
    try {
      for (const path of ["/plain", "/missing"]) {
        const source = new window.EventSource(path);
        let opened = false;
        let messaged = false;
        source.onopen = () => {
          opened = true;
        };
        source.onmessage = () => {
          messaged = true;
        };

        await next(source, "error");
        assert.equal(source.readyState, window.EventSource.CLOSED, path);
        assert.equal(opened, false, path);
        assert.equal(messaged, false, path);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(seen.length, 2);
    } finally {
      done();
    }
  });

  specify("fails a cross-origin stream the site does not share", async () => {
    const { window, done } = await site({
      "/events": (req, res, url) => {
        stream(res, url);
        res.end("data: x\n\n");
      }
    });
    try {
      const source = new window.EventSource("https://other.test/events");
      let messaged = false;
      source.onmessage = () => {
        messaged = true;
      };

      await next(source, "error");
      assert.equal(source.readyState, window.EventSource.CLOSED);
      assert.equal(messaged, false);
    } finally {
      done();
    }
  });

  specify("follows a redirect to another origin, stating its own, and reports the origin it ended at", async () => {
    const { window, seen, done } = await site({
      "/redirect": (req, res, url) => {
        res.writeHead(302, { "Location": "https://other.test/events", "BSBX-PROXY-HOST": url.href });
        res.end();
      },
      "/events": (req, res, url) => {
        if (!req.headers.origin) {
          res.writeHead(500, { "BSBX-PROXY-HOST": url.href });
          res.end();
          return;
        }
        stream(res, url, { "Access-Control-Allow-Origin": req.headers.origin });
        res.write("data: there\n\n");
      }
    });
    try {
      const source = new window.EventSource("/redirect");
      source.onerror = () => assert.fail("error event");
      const event = await next(source, "message");
      source.close();
      assert.equal(event.data, "there");
      assert.equal(event.origin, "https://other.test");
      assert.equal(seen[1].headers.origin, "https://site.test");
    } finally {
      done();
    }
  });

  specify("fails the connection to an address that is not http(s)", async () => {
    const { window, done } = await site({});
    try {
      for (const url of ["ftp://example.not/", "about:blank", "mailto:a@example.test", "javascript:void 0"]) {
        const source = new window.EventSource(url);
        const error = await next(source, "error");
        assert.equal(source.readyState, window.EventSource.CLOSED, url);
        assert.equal(error.constructor, window.Event, url);
      }
    } finally {
      done();
    }
  });

  specify("window.stop() fails the connection, and it is not made again", async () => {
    const { window, seen, done } = await site({
      "/events": (req, res, url) => {
        stream(res, url);
        res.write("retry: 10\n\n");
      }
    });
    try {
      const source = new window.EventSource("/events");
      await waitFor(() => seen.length === 1);
      window.stop();
      await next(source, "error");
      assert.equal(source.readyState, window.EventSource.CLOSED);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(seen.length, 1);
    } finally {
      done();
    }
  });

  specify("close() and the window closing abort the request", async () => {
    const { window, closed, done } = await site({
      "/events": (req, res, url) => {
        stream(res, url);
        res.write(": open\n\n");
      }
    });
    try {
      const source = new window.EventSource("/events");
      await next(source, "open");
      source.close();
      await waitFor(() => closed.length === 1);

      const second = new window.EventSource("/events?again");
      await next(second, "open");
      window.close();
      await waitFor(() => closed.length === 2);
    } finally {
      done();
    }
  });
});
