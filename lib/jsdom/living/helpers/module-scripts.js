"use strict";

// Who runs a module script.
//
// This library evaluates classic scripts and drops every other kind, which for
// `type="module"` means the page's own code never runs and the document simply
// comes out short. Implementing modules needs a loader — a graph to resolve,
// fetch and evaluate in order — and that belongs to whatever is already
// fetching this document's subresources, not here.
//
// With nothing installed the old behaviour stands: a module script is ignored,
// which is the honest report for a library that cannot run one.

let evaluateModule = null;

exports.setModuleEvaluator = evaluator => {
  evaluateModule = evaluator;
};

exports.hasModuleEvaluator = () => evaluateModule !== null;

/**
 * Hands one module script over to be run.
 *
 * `source` is the entry module's text and `url` the address to resolve its
 * imports against — for an inline module, the document's own. The rest of the
 * graph is fetched through `fetchText`, which goes through this document's own
 * resource loader so that a module is requested the way every other
 * subresource is.
 *
 * It answers with text rather than a response on purpose: a response body can
 * be read once, and the loader hands concurrent callers of one address the
 * same one, so the second module to read it finds it already consumed.
 */
exports.runModuleScript = (source, url, window, fetchText) =>
  evaluateModule({ source, url, window, fetchText });
