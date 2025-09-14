"use strict";

/**
 * Utility functions for handling proxy URL translation and header manipulation
 * shared between resource loader and XHR implementations
 */

/**
 * Translates a URL to use the proxy server
 * @param {string} originalUrl - The original URL to proxy
 * @param {string} proxyUrl - The proxy server URL
 * @returns {string} - The proxied URL
 */
function translateUrlForProxy(originalUrl, proxyUrl) {
    const originalUrlObj = new URL(originalUrl);
    const proxyUrlObj = new URL(proxyUrl);

    proxyUrlObj.pathname = "proxy" + originalUrlObj.pathname;
    proxyUrlObj.search = originalUrlObj.search;
    proxyUrlObj.hash = originalUrlObj.hash;

    return proxyUrlObj.toString();
}

/**
 * Adds proxy headers to the request headers
 * @param {Object} headers - The existing headers object
 * @param {string} originalUrl - The original URL being proxied
 * @returns {Object} - The headers with proxy headers added
 */
function addProxyHeaders(headers, originalUrl) {
    const originalUrlObj = new URL(originalUrl);

    return {
        ...headers,
        "BSBX-PROXY-HOST": originalUrlObj.origin
    };
}

/**
 * Restores the original URL from a proxied URL
 * @param {string} proxiedUrl - The proxied URL
 * @param {string} proxyUrl - The proxy server URL
 * @param {Function} getHeader - Function to get header values (should return BSBX-PROXY-HOST)
 * @returns {string} - The restored original URL
 */
function restoreOriginalUrl(proxiedUrl, proxyUrl, getHeader) {
    try {
        const proxyHost = getHeader("BSBX-PROXY-HOST");
        if (!proxyHost) {
            return proxiedUrl;
        }

        const pathAfterProxy = proxiedUrl.slice(proxyUrl.length);
        return proxyHost + pathAfterProxy;
    } catch (err) {
        // If there's any error in URL restoration, return the proxied URL as fallback
        return proxiedUrl;
    }
}

/**
 * Checks if a URL should be proxied (HTTP/HTTPS only)
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL should be proxied
 */
function shouldProxyUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === "http:" || urlObj.protocol === "https:";
    } catch (err) {
        return false;
    }
}

/**
 * Gets the proxy URL from the global object if available
 * @param {Object} globalObject - The window/global object
 * @returns {string|null} - The proxy URL or null if not available
 */
function getProxyUrl(globalObject) {
    if (globalObject && globalObject._resourceLoader && globalObject._resourceLoader.proxyUrl) {
        return globalObject._resourceLoader.proxyUrl;
    }
    return null;
}

module.exports = {
    translateUrlForProxy,
    addProxyHeaders,
    restoreOriginalUrl,
    shouldProxyUrl,
    getProxyUrl
};
