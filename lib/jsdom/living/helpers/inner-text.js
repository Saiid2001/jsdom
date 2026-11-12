"use strict";
const NODE_TYPE = require("../node-type");
const { domSymbolTree } = require("./internal-constants");
const { HTML_NS } = require("./namespaces");
const { createElement } = require("./create-element");

// https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute
//
// The rendered text collection steps read the used value of `display`,
// `visibility` and `white-space` for every node. Computing style for a whole
// subtree is a cascade per element, which a page reading `body.innerText`
// cannot afford, so the box each element generates is taken from its name
// instead: the elements the user agent style sheet makes blocks, table rows
// and cells, and the ones it hides. A page's own `display` is not consulted.

const HIDDEN = new Set([
  "area", "base", "basefont", "datalist", "head", "link", "meta", "noembed",
  "noframes", "param", "rp", "script", "style", "template", "title"
]);

const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "center", "dd", "details",
  "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "html",
  "legend", "li", "listing", "main", "menu", "nav", "ol", "optgroup", "option",
  "plaintext", "pre", "search", "section", "summary", "table", "tbody", "tfoot",
  "thead", "ul", "xmp", "caption"
]);

const PRESERVES_WHITESPACE = new Set(["pre", "listing", "plaintext", "xmp", "textarea"]);

function isHTML(node, localName) {
  return node._namespaceURI === HTML_NS && node._localName === localName;
}

function isHidden(element) {
  if (element._namespaceURI !== HTML_NS) {
    return false;
  }
  if (HIDDEN.has(element._localName)) {
    return true;
  }
  // A <noscript> is not rendered where scripts run, which is the only place
  // a script can ask for its text.
  const document = element._ownerDocument;
  if (element._localName === "noscript" && document._defaultView &&
      document._defaultView._runScripts === "dangerously" && !document._scriptingDisabled) {
    return true;
  }
  if (element.hasAttributeNS(null, "hidden") &&
      element.getAttributeNS(null, "hidden").toLowerCase() !== "until-found") {
    return true;
  }
  const inline = element._style && element._style.getPropertyValue("display");
  return inline === "none";
}

function preservesWhitespace(node) {
  for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (ancestor.nodeType === NODE_TYPE.ELEMENT_NODE && ancestor._namespaceURI === HTML_NS &&
        PRESERVES_WHITESPACE.has(ancestor._localName)) {
      return true;
    }
  }
  return false;
}

// Items are strings, numbers, or { preserved } for text whose white space is
// not collapsible; a number is a required line break count.
function collect(node, items) {
  if (node.nodeType === NODE_TYPE.TEXT_NODE || node.nodeType === NODE_TYPE.CDATA_SECTION_NODE) {
    const data = node._data;
    items.push(preservesWhitespace(node) ? { preserved: data } : data.replace(/[ \t\n\f\r]+/g, " "));
    return;
  }
  if (node.nodeType !== NODE_TYPE.ELEMENT_NODE) {
    return;
  }
  if (isHidden(node)) {
    return;
  }
  if (isHTML(node, "br")) {
    items.push("\n");
    return;
  }

  const name = node._namespaceURI === HTML_NS ? node._localName : null;
  const isCell = name === "td" || name === "th";
  const isRow = name === "tr";
  const isParagraph = name === "p";
  const isBlock = name !== null && (BLOCK.has(name) || isRow);

  if (isParagraph) {
    items.push(2);
  } else if (isBlock) {
    items.push(1);
  }

  for (const child of domSymbolTree.childrenIterator(node)) {
    collect(child, items);
  }

  if (isCell && domSymbolTree.nextSibling(node) !== null) {
    items.push("\t");
  }
  if (isParagraph) {
    items.push(2);
  } else if (isBlock) {
    items.push(1);
  }
}

function getInnerText(element) {
  if (!element._attached || isHidden(element)) {
    return element.textContent;
  }

  const items = [];
  for (const child of domSymbolTree.childrenIterator(element)) {
    collect(child, items);
  }

  // Collapsible spaces at the start and end of a line go, as do runs that
  // span text nodes; then each run of required line breaks becomes the
  // largest count in it, and leading and trailing ones are dropped.
  let output = "";
  let pending = 0;
  let atLineStart = true;
  for (const item of items) {
    if (typeof item === "number") {
      pending = Math.max(pending, item);
      continue;
    }
    const preserved = typeof item === "object";
    let text = preserved ? item.preserved : item;
    if (!preserved && (pending > 0 || atLineStart)) {
      text = text.replace(/^ +/, "");
      if (text === "") {
        continue;
      }
    }
    if (pending > 0) {
      if (output !== "") {
        output = output.replace(/ +$/, "") + "\n".repeat(pending);
      }
      pending = 0;
    }
    if (!preserved && output.endsWith(" ") && text.startsWith(" ")) {
      text = text.slice(1);
    }
    output += text;
    atLineStart = output.endsWith("\n");
  }
  return output.replace(/ +$/, "");
}

// https://html.spec.whatwg.org/multipage/dom.html#rendered-text-fragment
function setInnerText(element, value) {
  const document = element._ownerDocument;
  const fragment = document.createDocumentFragment();
  const lines = value.split(/\r\n|\r|\n/);
  lines.forEach((line, index) => {
    if (index > 0) {
      fragment._append(createElement(document, "br", HTML_NS));
    }
    if (line !== "") {
      fragment._append(document.createTextNode(line));
    }
  });
  element._replaceAll(fragment);
}

module.exports = { getInnerText, setInnerText };
