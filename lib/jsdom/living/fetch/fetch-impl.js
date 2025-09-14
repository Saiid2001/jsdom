// https://fetch.spec.whatwg.org/#fetch-method
const utils = require("../generated/utils");
const { NULL_BODY_STATUSES } = require("./Response-impl");
const MIMEType = require("whatwg-mimetype");
const idlUtils = require("../generated/utils");
const xhrUtils = require("../xhr/xhr-utils");
const DOMException = require("../generated/DOMException");
const implSymbol = utils.implSymbol;

("use strict");

class FetchTimingInfo {
    //     A fetch timing info is a struct used to maintain timing information needed by Resource Timing and Navigation Timing. It has the following items: [RESOURCE-TIMING] [NAVIGATION-TIMING]

    // start time (default 0)
    // redirect start time (default 0)
    // redirect end time (default 0)
    // post-redirect start time (default 0)
    // final service worker start time (default 0)
    // final network-request start time (default 0)
    // first interim network-response start time (default 0)
    // final network-response start time (default 0)
    // end time (default 0)
    // A DOMHighResTimeStamp.
    // final connection timing info (default null)
    // Null or a connection timing info.
    // server-timing headers (default « »)
    // A list of strings.
    // render-blocking (default false)
    // A boolean.

    constructor() {
        this.startTime = 0;
        this.redirectStartTime = 0;
        this.redirectEndTime = 0;
        this.postRedirectStartTime = 0;
        this.finalServiceWorkerStartTime = 0;
        this.finalNetworkRequestStartTime = 0;
        this.firstInterimNetworkResponseStartTime = 0;
        this.finalNetworkResponseStartTime = 0;
        this.endTime = 0;
        this.finalConnectionTimingInfo = null;
        this.serverTimingHeaders = [];
        this.renderBlocking = false;
    }
}

class FetchParams {
    // A fetch params is a struct used as a bookkeeping detail by the fetch algorithm. It has the following items:

    // request
    // A request.
    // process request body chunk length (default null)
    // process request end-of-body (default null)
    // process early hints response (default null)
    // process response (default null)
    // process response end-of-body (default null)
    // process response consume body (default null)
    // Null or an algorithm.
    // task destination (default null)
    // Null, a global object, or a parallel queue.
    // cross-origin isolated capability (default false)
    // A boolean.
    // controller (default a new fetch controller)
    // A fetch controller.
    // timing info
    // A fetch timing info.
    // preloaded response candidate (default null)
    // Null, "pending", or a response.

    constructor() {
        this.request = null;
        this.processRequestBodyChunkLength = null;
        this.processRequestEndOfBody = null;
        this.processEarlyHintsResponse = null;
        this.processResponse = null;
        this.processResponseEndOfBody = null;
        this.processResponseConsumeBody = null;
        this.taskDestination = null;
        this.crossOriginIsolatedCapability = false;
        this.controller = new FetchController();
        this.timingInfo = new FetchTimingInfo();
        this.preloadedResponseCandidate = null;
    }
}

class FetchController {
    // fetch controller is a struct used to enable callers of fetch to perform certain operations on it after it has started. It has the following items:

    // state (default "ongoing")
    // "ongoing", "terminated", or "aborted"
    // full timing info (default null)
    // Null or a fetch timing info.
    // report timing steps (default null)
    // Null or an algorithm accepting a global object.
    // serialized abort reason (default null)
    // Null or a Record (result of StructuredSerialize).
    // next manual redirect steps (default null)
    // Null or an algorithm accepting nothing.

    constructor() {
        this.state = "ongoing";
        this.fullTimingInfo = null;
        this.reportTimingSteps = null;
        this.serializedAbortReason = null;
        this.nextManualRedirectSteps = null;
    }

    // To abort a fetch controller controller with an optional error:

    // Set controller’s state to "aborted".

    // Let fallbackError be an "AbortError" DOMException.

    // Set error to fallbackError if it is not given.

    // Let serializedError be StructuredSerialize(error). If that threw an exception, catch it, and let serializedError be StructuredSerialize(fallbackError).

    // Set controller’s serialized abort reason to serializedError.

    // To deserialize a serialized abort reason, given null or a Record abortReason and a realm realm:

    // Let fallbackError be an "AbortError" DOMException.

    // Let deserializedError be fallbackError.

    // If abortReason is non-null, then set deserializedError to StructuredDeserialize(abortReason, realm). If that threw an exception or returned undefined, then set deserializedError to fallbackError.

    // Return deserializedError.

    // To terminate a fetch controller controller, set controller’s state to "terminated".


    abort(error = null) {

        function structuredSerialize(value) {
            // A very simplified version of structured serialize for DOMException only
            if (value instanceof DOMException) {
                return {
                    name: value.name,
                    message: value.message,
                    code: value.code,
                    stack: value.stack
                };
            }
            throw new TypeError("Value cannot be structured serialized");
        }

        this.state = "aborted";

        const fallbackError = DOMException.create(null, ["The operation was aborted.", "AbortError"]);

        if (!error) {
            error = fallbackError;
        }

        let serializedError = null;
        try {
            serializedError = structuredSerialize(error);
        } catch (e) {
            serializedError = structuredSerialize(fallbackError);
        }       
        this.serializedAbortReason = serializedError;
    }


}

class FetchRecord {
    constructor(request, controller = null) {
        this.request = request;
        this.controller = controller;
    }
}

function _fetch(
    request,
    globalObject,
    processRequestBodyChunkLength = null,
    processRequestEndOfBody = null,
    processEarlyHintsResponse = null,
    processResponse = null,
    processResponseEndOfBody = null,
    processResponseConsumeBody = null,
    useParallelQueue = false,
) {

    if (!(request.mode === "navigate" || processEarlyHintsResponse == null)) {
        throw new TypeError("processEarlyHintsResponse must be null if request's mode is not 'navigate'");
    }

    let taskDestination = globalObject;
    let crossOriginIsolatedCapability = false;

    // [from specs] To populate request from client given a request request:
    // DEV: ignore traversable for user prompt
    // DEV: ignore client since we do not support it

    // DEV: we do not support parallel queues

    const timingInfo = new FetchTimingInfo();
    timingInfo.startTime = globalObject.performance.now();
    timingInfo.postRedirectStartTime = timingInfo.startTime;

    const fetchParams = new FetchParams();
    fetchParams.request = request;
    fetchParams.processRequestBodyChunkLength = processRequestBodyChunkLength;
    fetchParams.processRequestEndOfBody = processRequestEndOfBody;
    fetchParams.processEarlyHintsResponse = processEarlyHintsResponse;
    fetchParams.processResponse = processResponse;
    fetchParams.processResponseEndOfBody = processResponseEndOfBody;
    fetchParams.processResponseConsumeBody = processResponseConsumeBody;
    fetchParams.taskDestination = taskDestination;
    fetchParams.crossOriginIsolatedCapability = crossOriginIsolatedCapability;
    fetchParams.timingInfo = timingInfo;

    // DEV: SKIP If request’s body is a byte sequence, then set request’s body to request’s body as a body.

    // HTTPS GET
    // DEV: SKIP Preloading


    // Handling Accept
    if (!request.headers.has("accept")) {
        let value = "*/*";
        // DEV: we only support destination: ""
        request.headers.set("accept", value);
    }

    if (!request.headers.has("accept-language")) {
        // DEV: We do not support language negotiation, so just set to "en-US"
        request.headers.set("accept-language", "en-US");
    }

    // always subresource
    const fetchRecord = new FetchRecord(request, fetchParams.controller);

    // Add to global fetch records
    if (!globalObject._fetchRecords) {
        globalObject._fetchGroup = {
            fetchRecords: [],
            deferredFetchRecords: []
        }
    }

    globalObject._fetchGroup.fetchRecords.push(fetchRecord);

    _mainFetch(fetchParams, globalObject);

    return fetchParams.controller;
}

function _getServerTimingHeaders(internalResponse) {
    const serverTimingHeader = internalResponse.headers.get("server-timing");
    if (!serverTimingHeader) return [];
    return serverTimingHeader.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

async function _mainFetch(fetchParams, globalObject, recursive = false) {

    const Response = globalObject.Response;

    // all referrers will be the owner document
    let _ownerDocument = idlUtils.implForWrapper(globalObject._document);
    const documentOrigin = new URL(_ownerDocument.URL).origin;

    let request = fetchParams.request;
    let response = null;

    // DEV: SKIP service workers, CSP, and cache

    if (request.referrer !== "no-referrer") {
        if (request.referrer === "client") {
            request.referrer = _ownerDocument.URL;
        } else {
            let parsedReferrer = new URL(request.referrer, _ownerDocument.URL);
            if (parsedReferrer.protocol === "about:" && parsedReferrer.pathname === "client") {
                request.referrer = _ownerDocument.URL;
            }
            // sanitize referrer
            // DEV: We do not support referrer policy, so just always send full URL
            // removing username, password, and fragment
            let sanitizedReferrer = new URL(request.referrer);
            sanitizedReferrer.username = "";
            sanitizedReferrer.password = "";
            sanitizedReferrer.hash = "";
            request.referrer = sanitizedReferrer.href;
        }
    }

    // DEV: SKIP HTTPS upgrade

    // mode = navigate is not supported and blocked inside Request-impl.js

    const requestUrl = new URL(request.url);

    if (request.mode === "same-origin" && requestUrl.origin !== documentOrigin) {
        response = Response.error();
        console.error(`Fetch failed: Request mode is 'same-origin' but request origin (${requestUrl.origin}) is not same as document origin (${documentOrigin})`);
    }

    if (!response && request.mode === 'no-cors') {
        if (request.redirect !== 'follow') {
            response = Response.error();
            console.error("Fetch failed: Request mode is 'no-cors' but redirect mode is not 'manual'");
        }
        else {
            response = await _overrideFetch(fetchParams, globalObject, 'scheme-fetch');
        }
    }

    if (!response && requestUrl.scheme !== "http" && requestUrl.scheme !== "https") {
        response = Response.error();
        console.error(`Fetch failed: URL scheme "${requestUrl.scheme}" is not supported`);
    }

    // DEV: SKIP CORS preflight

    if (!response) {
        response = await _overrideFetch(fetchParams, globalObject, 'http-fetch');
    }

    if (recursive) return response;

    let internalResponse = response;

    if (internalResponse[implSymbol]._urlList.length == 0) internalResponse[implSymbol]._urlList = request[implSymbol].urlList.slice();

    if (internalResponse.status !== 0 && (new Set(['HEAD', 'CONNECT']).has(request.method)) && NULL_BODY_STATUSES.has(internalResponse.status)) {
        response[implSymbol]._typedStream = null;
        response[implSymbol]._bodyBuffer = null;
        response[implSymbol]._bodyUsed = false;
    }

    // DEV: SKIP integrity metadata

    // Fetch response handover
    // set timingInfo’s server-timing headers to the result of getting, decoding, and splitting `Server-Timing` from response’s internal response’s header list.

    fetchParams.timingInfo.serverTimingHeaders = _getServerTimingHeaders(internalResponse);

    let processResponseEndOfBody = () => {
        fetchParams.controller.reportTimingSteps = (globalObject) => {

            fetchParams.timingInfo.endTime = globalObject.performance.now();

            let responseStatus = response.status;
            let mimeType = MIMEType.parse(response.headers.get("content-type") || "text/plain");
            let finalMimeType = null;
            if (mimeType.isJavaScript()) finalMimeType = "text/javascript";
            else if (mimeType.essence.includes("+json")) finalMimeType = "application/json";
            else if (mimeType.isXML()) finalMimeType = "application/xml";
            else finalMimeType = mimeType.essence;

            response.headers.set("content-type", finalMimeType);
            if(response[implSymbol]._typedStream) response[implSymbol]._typedStream.contentType = finalMimeType;
        }

        let processResponseEndOfBodyTask = () => {
            fetchParams.request[implSymbol].flags.done = true;

            // Call process response end-of-body if provided
            if (fetchParams.processResponseEndOfBody) {
                try {
                    fetchParams.processResponseEndOfBody(response);
                } catch (err) {
                    // Ignore errors in end-of-body processing
                }
            }
        }

        // Queue a fetch task to run processResponseEndOfBodyTask with fetchParams's task destination
        // In JSDOM, we use setImmediate to queue tasks to the event loop
        setTimeout(() => {
            processResponseEndOfBodyTask();
        }, 0); 
    }

    // Process response
    if (fetchParams.processResponse) fetchParams.processResponse(response);

    // We should call this only when body is fully received. But since we fetch all the body in xhr-utils, we call it here immediately.
    processResponseEndOfBody();

}

// https://fetch.spec.whatwg.org/#override-fetch
function _overrideFetch(fetchParams, globalObject, type, makeCORSPreflight = false) {

    // type is ignored here since xhr-utils handles both scheme-fetch and http-fetch

    // 2. Let response be the result of executing potentially override response for a request on request.
    // DEV: Ignore since no interception expected in prototype

    const request = fetchParams.request;
    const Response = globalObject.Response;

    // Create a mock XHR-like object to reuse xhr-utils.createClient
    const mockXHR = {
        _globalObject: globalObject,
        flag: {
            method: request.method,
            uri: request.url,
            requestHeaders: {},
            referrer: request.referrer === "no-referrer" ? "" : request.referrer,
            withCredentials: request.credentials === "include",
            auth: null,
            body: request.body,
            formData: false,
            preflight: makeCORSPreflight,
            requestManager: globalObject._document._requestManager,
            strictSSL: globalObject._resourceLoader ? globalObject._resourceLoader._strictSSL : true,
            proxy: globalObject._resourceLoader ? globalObject._resourceLoader._proxy : null,
            cookieJar: globalObject._document._cookieJar,
            origin: new URL(globalObject._document.URL).origin,
            userAgent: globalObject.navigator.userAgent
        },
        properties: {
            error: null,
            uploadListener: false,
            uploadComplete: true,
            abortError: false
        }
    };

    // Copy headers from request to mockXHR
    for (const [name, value] of request.headers) {
        mockXHR.flag.requestHeaders[name] = value;
    }

    return new Promise((resolve, reject) => {
        try {
            const client = xhrUtils.createClient(mockXHR);
            let responseBuffer = Buffer.alloc(0);
            let respnse = null;

            client.on("error", (err) => {
                client.removeAllListeners();
                reject(err);
            });

            client.on("response", (res, url) => {
                const headers = new globalObject.Headers();

                // Copy response headers
                Object.keys(res.headers).forEach(name => {
                    headers.set(name, res.headers[name]);
                });

                response = new Response(null, {
                    status: res.statusCode,
                    statusText: res.statusMessage || "",
                    headers: headers
                });

                // Set response URL
                response[implSymbol]._url = url;
                response[implSymbol]._urlList = [url];
            });

            client.on("data", (chunk) => {
                responseBuffer = Buffer.concat([responseBuffer, chunk]);
            });

            client.on("end", () => {
                client.removeAllListeners();
                if (response) {
                    // Set the response body
                    response[implSymbol]._bodyBuffer = responseBuffer;
                    response[implSymbol]._bodyUsed = false;
                    resolve(response);
                } else {
                    // Create error response if no response was received
                    resolve(Response.error());
                }
            });

            client.on("abort", () => {
                client.removeAllListeners();
                reject(new DOMException("The operation was aborted.", "AbortError"));
            });

        } catch (err) {
            reject(err);
        }
    });
}

function jsdomFetch(globalObject, input, init = {}) {

    const Request = globalObject.Request;
    const AbortController = globalObject.AbortController;

    function _abortFetch(reject, request, response = null, error = null) {

        if (request.body && !request.bodyUsed) {
            // If request's body is non-null and is readable, then cancel request's body with error.
            try {
                // Get the underlying stream from the request body
                const bodyStream = request.body;

                // Cancel/destroy the readable stream with the error
                if (bodyStream && typeof bodyStream.destroy === 'function') {
                    bodyStream.destroy(error || new DOMException('The operation was aborted.', 'AbortError'));
                } else if (bodyStream && typeof bodyStream.cancel === 'function') {
                    bodyStream.cancel(error || new DOMException('The operation was aborted.', 'AbortError'));
                }

                // Mark the body as used to prevent further operations
                request._bodyUsed = true;
            } catch (streamError) {
                // If stream cancellation fails, continue with abort process
                console.warn('Failed to cancel request body stream:', streamError);
            }
        }

        if (response && !response.bodyUsed) {
            // If response's body is non-null and is readable, then error response's body with error.
            try {
                // Get the underlying stream from the response body
                const bodyStream = response.body;

                // Cancel/destroy the readable stream with the error
                if (bodyStream && typeof bodyStream.destroy === 'function') {
                    bodyStream.destroy(error || new DOMException('The operation was aborted.', 'AbortError'));
                } else if (bodyStream && typeof bodyStream.cancel === 'function') {
                    bodyStream.cancel(error || new DOMException('The operation was aborted.', 'AbortError'));
                }

                // Mark the body as used to prevent further operations
                response._bodyUsed = true;
            } catch (streamError) {
                // If stream cancellation fails, continue with abort process
                console.warn('Failed to cancel response body stream:', streamError);
            }
        }

        // Reject the promise with appropriate error
        const abortError = error || new DOMException('The operation was aborted.', 'AbortError');
        reject(abortError);

    }

    return new Promise((resolve, reject) => {
        try {


            let controller = null;

            const request = new Request(input, init);

            if (request.signal?.aborted) {
                _abortFetch(reject, request, null, request.signal.reason);
            }

            let response = null;

            let locallyAborted = false;

            const onAbort = () => {
                // Set locallyAborted to true
                locallyAborted = true;

                // Assert: controller is non-null
                if (controller === null) {
                    throw new Error('Assertion failed: controller should be non-null');
                }

                // Abort controller with requestObject's signal's abort reason
                controller.abort(request.signal.reason);

                // Abort the fetch() call with p, request, responseObject, and requestObject's signal's abort reason
                _abortFetch(reject, request, response, request.signal.reason);
            }

            // Add the abort steps to requestObject's signal
            request.signal.addEventListener('abort', onAbort);

            // Define process response callback
            const processResponse = (response) => {
                if (locallyAborted) {
                    _abortFetch(reject, request, response, request.signal.reason);
                    return;
                }

                if (response.status === 0) {
                    reject(new TypeError('Network request failed'));
                    return;
                }
                resolve(response);
            };

            // Call the internal _fetch function
            controller = _fetch(
                request,
                globalObject,
                null, // processRequestBodyChunkLength
                null, // processRequestEndOfBody
                null, // processEarlyHintsResponse
                processResponse, // processResponse
                null, // processResponseEndOfBody
                null, // processResponseConsumeBody
                false // useParallelQueue
            );

        }
        catch (e) {
            reject(e);
            return;
        }
    });
}

// ****************** NOT IMPLEMENTED *******************************
// dictionary DeferredRequestInit : RequestInit {
//   DOMHighResTimeStamp activateAfter;
// };
//
// [Exposed=Window]
// interface FetchLaterResult {
//   readonly attribute boolean activated;
// };

// partial interface Window {
//   [NewObject] FetchLaterResult fetchLater(RequestInfo input, optional DeferredRequestInit init = {});
// };

module.exports = {
    jsdomFetch
};