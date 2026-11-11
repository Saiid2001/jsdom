"use strict";

const produceXMLSerialization = require("w3c-xmlserializer");
const parse5 = require("parse5");
const DOMException = require("../generated/DOMException");

const utils = require("../generated/utils");
const treeAdapter = require("./parse5-adapter-serialization");
const NODE_TYPE = require("../node-type");
const { HTML_NS } = require("../helpers/namespaces");

module.exports.fragmentSerialization = (node, { outer, requireWellFormed, globalObject }) => {
  const contextDocument =
    node.nodeType === NODE_TYPE.DOCUMENT_NODE ? node : node._ownerDocument;
  if (contextDocument._parsingMode === "html") {
    const config = {
      ...contextDocument._parseOptions,
      treeAdapter
    };
    return outer ? parse5.serializeOuter(node, config) : parse5.serialize(node, config);
  }

  const childNodes = outer ? [node] : node.childNodes;

  try {
    let serialized = "";
    for (let i = 0; i < childNodes.length; ++i) {
      serialized += produceXMLSerialization(
        utils.wrapperForImpl(childNodes[i] || childNodes.item(i)),
        { requireWellFormed }
      );
    }
    return serialized;
  } catch (e) {
    throw DOMException.create(globalObject, [e.message, "InvalidStateError"]);
  }
};

// The attributes a declarative shadow root is written back out with, in the order the spec appends them.
function shadowRootAttributes(shadow) {
  const attrs = [["shadowrootmode", shadow._mode === "open" ? "open" : "closed"]];
  if (shadow._delegatesFocus) {
    attrs.push(["shadowrootdelegatesfocus", ""]);
  }
  if (shadow._serializable) {
    attrs.push(["shadowrootserializable", ""]);
  }
  if (shadow._slotAssignment === "manual") {
    attrs.push(["shadowrootslotassignment", "manual"]);
  }
  if (shadow._clonable) {
    attrs.push(["shadowrootclonable", ""]);
  }
  return attrs.map(([name, value]) => ({ name, value, namespace: null, prefix: null }));
}

// https://html.spec.whatwg.org/multipage/parsing.html#serialising-html-fragments, with its shadow host step (4).
//
// parse5's serializer has no notion of a shadow root, so the step is given to it as a tree: a host whose root is
// to be serialized reports, ahead of its children, a template element that exists only for the serializer and whose
// template contents are the shadow root. The serializer then writes the start tag, the root's children (recursing
// into hosts among them the same way) and the end tag, with its own escaping.
module.exports.htmlFragmentSerialization = (node, { serializableShadowRoots, shadowRoots }) => {
  const included = shadow => (serializableShadowRoots && shadow._serializable) || shadowRoots.includes(shadow);

  const adapter = {
    ...treeAdapter,
    getChildNodes(parent) {
      const children = treeAdapter.getChildNodes(parent);
      const shadow = parent.nodeType === NODE_TYPE.ELEMENT_NODE ? parent._shadowRoot : null;
      if (!shadow || !included(shadow)) {
        return children;
      }

      const template = {
        nodeType: NODE_TYPE.ELEMENT_NODE,
        namespaceURI: HTML_NS,
        _qualifiedName: "template",
        _attributeList: shadowRootAttributes(shadow),
        _isValue: null,
        _templateContents: shadow
      };
      return [template, ...children];
    }
  };

  const contextDocument = node.nodeType === NODE_TYPE.DOCUMENT_NODE ? node : node._ownerDocument;
  return parse5.serialize(node, { ...contextDocument._parseOptions, treeAdapter: adapter });
};
