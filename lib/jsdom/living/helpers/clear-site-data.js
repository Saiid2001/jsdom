"use strict";
const { getPublicSuffix } = require("tough-cookie");
const { headerValue, getDecodeSplit } = require("./content-type");

// Clear-Site-Data (https://w3c.github.io/webappsec-clear-site-data/).
//
// Cookies live in the cookie jar a request carries, so they are cleared here.
// Everything else an origin keeps — Web Storage, IndexedDB, caches — is held
// by whoever made the documents, and is cleared by the provider the host
// application installs with setClearSiteData. "executionContexts" is parsed
// and handed to the provider like the rest; this library does not reload
// documents for it.

const TYPES = ["cache", "cookies", "storage", "executionContexts"];

// Called with { origin, site, types } once a response's cookies are cleared.
let provider = null;

exports.setClearSiteData = fn => {
  provider = typeof fn === "function" ? fn : null;
};

// https://w3c.github.io/webappsec-clear-site-data/#parsing
//
// Each type is a quoted string, matched exactly; "*" is every type.
function parseClearSiteData(value) {
  const types = new Set();
  const values = getDecodeSplit(value);

  if (values === null) {
    return types;
  }

  for (const each of values) {
    if (each === "\"*\"") {
      for (const type of TYPES) {
        types.add(type);
      }
      continue;
    }

    for (const type of TYPES) {
      if (each === `"${type}"`) {
        types.add(type);
      }
    }
  }

  return types;
}

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

// https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy, for
// the schemes a response arrives on.
function isPotentiallyTrustworthy(url) {
  if (url.protocol === "https:" || url.protocol === "wss:") {
    return true;
  }

  const host = url.hostname.toLowerCase();

  return host === "localhost" || host.endsWith(".localhost") || LOOPBACK_V4.test(host) || host === "[::1]";
}

// The registrable domain of a host, or the host itself where it has none (an
// IP address, or a name that is all public suffix).
function siteOf(host) {
  let site = null;

  try {
    site = getPublicSuffix(host, { allowSpecialUseDomain: true });
  } catch {
    site = null;
  }

  return site || host;
}

function domainMatchesSite(domain, site) {
  const bare = String(domain || "").replace(/^\./, "").toLowerCase();
  return bare === site || bare.endsWith(`.${site}`);
}

// https://w3c.github.io/webappsec-clear-site-data/#clear-cookies
function clearCookies(cookieJar, site) {
  const store = cookieJar && cookieJar.store;

  if (!store || typeof store.getAllCookies !== "function" || typeof store.removeCookie !== "function") {
    return;
  }

  let cookies = [];
  store.getAllCookies((error, all) => {
    cookies = error ? [] : all || [];
  });

  for (const cookie of cookies) {
    if (domainMatchesSite(cookie.domain, site)) {
      store.removeCookie(cookie.domain, cookie.path, cookie.key, () => {});
    }
  }
}

// https://w3c.github.io/webappsec-clear-site-data/#fetch-integration
//
// `url` is the response's, after redirects; `headers` its header list in any
// of the shapes content-type.js reads. `topLevelURL` is the address of the
// top-level document the request was made for, where there is one: a response
// to a request made from another site is in a third-party context, and clears
// nothing, there being no partitioned storage here for it to clear.
//
// Answers the set of types it acted on.
function clearSiteDataForResponse({ url, headers, cookieJar, topLevelURL }) {
  const value = headerValue(headers, "clear-site-data");

  if (value === null) {
    return new Set();
  }

  let parsedURL;
  try {
    parsedURL = new URL(url);
  } catch {
    return new Set();
  }

  if (!isPotentiallyTrustworthy(parsedURL)) {
    return new Set();
  }

  const types = parseClearSiteData(value);

  if (types.size === 0) {
    return types;
  }

  const site = siteOf(parsedURL.hostname.toLowerCase());

  if (topLevelURL) {
    let topLevelSite = null;
    try {
      const topLevel = new URL(topLevelURL);
      topLevelSite = `${topLevel.protocol}${siteOf(topLevel.hostname.toLowerCase())}`;
    } catch {
      topLevelSite = null;
    }

    if (topLevelSite !== null && topLevelSite !== `${parsedURL.protocol}${site}`) {
      return new Set();
    }
  }

  if (types.has("cookies")) {
    clearCookies(cookieJar, site);
  }

  if (provider) {
    try {
      provider({ origin: parsedURL.origin, site, types });
    } catch {
      // What the host application keeps failing to clear does not fail the response.
    }
  }

  return types;
}

exports.parseClearSiteData = parseClearSiteData;
exports.isPotentiallyTrustworthy = isPotentiallyTrustworthy;
exports.clearSiteDataForResponse = clearSiteDataForResponse;
