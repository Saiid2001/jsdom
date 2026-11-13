"use strict";
const idlUtils = require("../generated/utils");

// The referrer a request carries, reduced by its referrer policy
// (https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer).

const POLICIES = new Set([
  "no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin",
  "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url"
]);

// The last valid token of a Referrer-Policy header value, or "".
// https://w3c.github.io/webappsec-referrer-policy/#parse-referrer-policy-from-header
exports.parsePolicy = value => {
  let policy = "";

  for (const token of String(value || "").split(",")) {
    const trimmed = token.trim().toLowerCase();

    if (POLICIES.has(trimmed)) {
      policy = trimmed;
    }
  }

  return policy;
};

// The policy a document declares with <meta name="referrer">, or "".
exports.documentPolicy = documentOrImpl => {
  const document = idlUtils.tryWrapperForImpl(documentOrImpl);

  if (!document || typeof document.querySelectorAll !== "function") {
    return "";
  }

  let policy = "";

  for (const meta of document.querySelectorAll("meta[name=referrer i]")) {
    const parsed = exports.parsePolicy(meta.getAttribute("content"));

    if (parsed) {
      policy = parsed;
    }
  }

  return policy;
};

// The Referer for a request to `target` made by `referrer` under `policy`,
// or null for none.
exports.determineReferrer = (referrer, target, policy) => {
  let source, destination;

  try {
    source = new URL(String(referrer));
    destination = new URL(String(target));
  } catch {
    return null;
  }

  if (source.protocol !== "http:" && source.protocol !== "https:") {
    return null;
  }

  source.hash = "";
  source.username = "";
  source.password = "";

  const full = source.href;
  const origin = source.origin + "/";
  const sameOrigin = source.origin === destination.origin;
  const downgrade = source.protocol === "https:" && destination.protocol !== "https:";

  switch (policy || "strict-origin-when-cross-origin") {
    case "no-referrer":
      return null;
    case "no-referrer-when-downgrade":
      return downgrade ? null : full;
    case "same-origin":
      return sameOrigin ? full : null;
    case "origin":
      return origin;
    case "strict-origin":
      return downgrade ? null : origin;
    case "origin-when-cross-origin":
      return sameOrigin ? full : origin;
    case "unsafe-url":
      return full;
    default:
      return sameOrigin ? full : downgrade ? null : origin;
  }
};
