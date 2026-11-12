"use strict";
const whatwgURL = require("whatwg-url");
const { asciiLowercase } = require("./strings");
const { parseURLToResultingURLRecord } = require("./document-base-url");

// Animation frames wait while a document is render-blocked: while its head is still being parsed, and while a
// `<link rel=expect blocking=render>` added then is waiting for the element it names. Nothing else blocks rendering
// here; a style sheet or script marked `blocking=render` does not.
// https://html.spec.whatwg.org/multipage/dom.html#render-blocked
// https://html.spec.whatwg.org/multipage/links.html#link-type-expect

function tokens(element, name) {
  const value = element.getAttributeNS(null, name);
  return value === null ? [] : asciiLowercase(value).split(/[\t\n\f\r ]+/);
}

function parsing(document) {
  return Boolean(document._parsing) || document.readyState === "loading";
}

// https://html.spec.whatwg.org/multipage/dom.html#allows-adding-render-blocking-elements
function allowsAddingRenderBlockingElements(document) {
  return parsing(document) && document.body === null;
}

function mediaMatches(link) {
  const media = link.getAttributeNS(null, "media");
  const window = link._ownerDocument._defaultView;

  if (media === null || media.trim() === "" || !window || typeof window.matchMedia !== "function") {
    return true;
  }

  try {
    return window.matchMedia(media).matches;
  } catch {
    return true;
  }
}

// The decoded fragment the link points at in its own document, or null when it points anywhere else.
function indicatedFragment(link) {
  const document = link._ownerDocument;
  const href = link.getAttributeNS(null, "href");

  if (href === null) {
    return null;
  }

  const url = parseURLToResultingURLRecord(href, document);

  if (url === null || url.fragment === null ||
      whatwgURL.serializeURL(url, true) !== whatwgURL.serializeURL(document._URL, true)) {
    return null;
  }

  return whatwgURL.percentDecodeString(url.fragment).toString();
}

function applies(link) {
  return link.isConnected &&
    tokens(link, "rel").includes("expect") &&
    tokens(link, "blocking").includes("render") &&
    mediaMatches(link) &&
    indicatedFragment(link) !== null;
}

// The top of the document is not an element, so a link to it waits for the whole document.
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#select-the-indicated-part
function targetParsed(document, fragment) {
  if (fragment === "" || asciiLowercase(fragment) === "top") {
    return false;
  }

  let target = document.getElementById(fragment);

  if (!target) {
    for (const anchor of document.getElementsByTagName("a")) {
      if (anchor.getAttributeNS(null, "name") === fragment) {
        target = anchor;
        break;
      }
    }
  }

  // An element the parser has opened but not closed has children still to come.
  return Boolean(target) && !target._parserOpen;
}

// Called when a link is connected, disconnected, or has an attribute changed.
exports.updateExpectLink = link => {
  const document = link._ownerDocument;
  const blocking = document._renderBlockingLinks || (document._renderBlockingLinks = new Set());

  if (!applies(link)) {
    blocking.delete(link);
    return;
  }

  if (!blocking.has(link) && allowsAddingRenderBlockingElements(document)) {
    blocking.add(link);
  }
};

exports.isRenderBlocked = document => {
  if (!parsing(document)) {
    if (document._renderBlockingLinks) {
      document._renderBlockingLinks.clear();
    }
    return false;
  }

  if (document.body === null) {
    return true;
  }

  const blocking = document._renderBlockingLinks;

  if (!blocking) {
    return false;
  }

  for (const link of blocking) {
    if (targetParsed(document, indicatedFragment(link))) {
      blocking.delete(link);
    }
  }

  return blocking.size > 0;
};
