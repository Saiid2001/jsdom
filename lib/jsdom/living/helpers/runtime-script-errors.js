"use strict";
const util = require("util");
const idlUtils = require("../generated/utils");
const ErrorEvent = require("../generated/ErrorEvent");
const { createAnEvent } = require("../helpers/events");

const errorReportingMode = Symbol("error reporting mode");

// https://html.spec.whatwg.org/multipage/webappapis.html#report-the-error
// Omits script parameter and any check for muted errors.
// Takes target as an EventTarget impl.
// Takes error object, message, and location as params, unlike the spec.
// Returns whether the event was handled or not.
function reportAnError(line, col, target, errorObject, message, location) {
  if (target[errorReportingMode]) {
    return false;
  }

  target[errorReportingMode] = true;

  if (typeof message !== "string") {
    message = "uncaught exception: " + util.inspect(errorObject);
  }

  const event = createAnEvent("error", target._globalObject, ErrorEvent, {
    cancelable: true,
    message,
    filename: location,
    lineno: line,
    colno: col,
    error: errorObject
  });

  try {
    target._dispatch(event);
  } finally {
    target[errorReportingMode] = false;
    return event.defaultPrevented;
  }
}

module.exports = function reportException(window, error, filenameHint) {
  // This function will give good results on real Error objects with stacks; poor ones otherwise

  const stack = error && error.stack;
  const lines = stack && stack.split("\n");

  // Find the first line that matches; important for multi-line messages
  let pieces;
  if (lines) {
    for (let i = 1; i < lines.length && !pieces; ++i) {
      pieces = lines[i].match(/at (?:(.+)\s+)?\(?(?:(.+?):(\d+):(\d+)|([^)]+))\)?/);
    }
  }

  const fileName = (pieces && pieces[2]) || filenameHint || window._document.URL;
  const lineNumber = (pieces && parseInt(pieces[3])) || 0;
  const columnNumber = (pieces && parseInt(pieces[4])) || 0;

  const windowImpl = idlUtils.implForWrapper(window);

  const handled = reportAnError(lineNumber, columnNumber, windowImpl, error, error && error.message, fileName);

  if (!handled) {
    const errorString = shouldBeDisplayedAsError(error) ? `[${error.name}: ${error.message}]` : util.inspect(error);
    const jsdomError = new Error(`Uncaught ${errorString}`);
    jsdomError.detail = error;
    jsdomError.type = "unhandled exception";

    window._virtualConsole.emit("jsdomError", jsdomError);
  }
};

// https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror
// Reports `error` as if it were thrown at the place reportError() was called from. Nothing is read off an object that
// is not an Error, so a page's getters on what it reports are not run.
module.exports.reportError = function reportError(window, error, callerStack) {
  const isError = error instanceof Error || (typeof window.Error === "function" && error instanceof window.Error);

  const lines = typeof callerStack === "string" ? callerStack.split("\n") : [];
  let pieces;
  for (let i = 2; i < lines.length && !pieces; ++i) {
    pieces = lines[i].match(/at (?:(.+)\s+)?\(?(?:(.+?):(\d+):(\d+)|([^)]+))\)?/);
  }

  const fileName = (pieces && pieces[2]) || window._document.URL;
  const lineNumber = (pieces && parseInt(pieces[3])) || 0;
  const columnNumber = (pieces && parseInt(pieces[4])) || 0;

  let message = "";
  if (isError) {
    message = `Uncaught ${error.name}${error.message ? `: ${error.message}` : ""}`;
  } else if (error !== null && (typeof error === "object" || typeof error === "function")) {
    message = "Uncaught exception";
  } else {
    message = `Uncaught ${typeof error === "symbol" ? error.toString() : String(error)}`;
  }

  const handled = reportAnError(lineNumber, columnNumber, idlUtils.implForWrapper(window), error, message, fileName);

  if (!handled) {
    const jsdomError = new Error(message);
    jsdomError.detail = error;
    jsdomError.type = "unhandled exception";
    window._virtualConsole.emit("jsdomError", jsdomError);
  }
};

function shouldBeDisplayedAsError(x) {
  return x && x.name && x.message !== undefined && x.stack;
}
