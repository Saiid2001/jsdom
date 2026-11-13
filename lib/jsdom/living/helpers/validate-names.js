"use strict";
const xnv = require("xml-name-validator");
const DOMException = require("../generated/DOMException");
const { XML_NS, XMLNS_NS } = require("../helpers/namespaces");

// https://dom.spec.whatwg.org/#namespaces, the name rules whatwg/dom#1079 relaxed names to.

function invalidCharacter(globalObject, message) {
  return DOMException.create(globalObject, [message, "InvalidCharacterError"]);
}

// ASCII whitespace, U+0000 NULL, and the characters each kind of name excludes.
const notInNamespacePrefix = /[\t\n\f\r \0/>]/;
const notInAttributeLocalName = /[\t\n\f\r \0/=>]/;
const notInDoctypeName = /[\t\n\f\r \0>]/;
const validElementLocalName =
  /^(?:[A-Za-z][^\0\t\n\f\r\u0020/>]*|[:_\u0080-\u{10FFFF}][A-Za-z0-9\-.:_\u0080-\u{10FFFF}]*)$/u;

exports.isValidElementLocalName = name => validElementLocalName.test(name);
exports.isValidAttributeLocalName = name => name.length > 0 && !notInAttributeLocalName.test(name);
exports.isValidNamespacePrefix = name => name.length > 0 && !notInNamespacePrefix.test(name);
exports.isValidDoctypeName = name => !notInDoctypeName.test(name);

// The XML Name production: what a processing instruction's target still has to match.
exports.name = (globalObject, name) => {
  if (!xnv.name(name)) {
    throw invalidCharacter(globalObject, `"${name}" did not match the Name production`);
  }
};

// https://dom.spec.whatwg.org/#valid-element-local-name
exports.elementLocalName = (globalObject, name) => {
  if (!exports.isValidElementLocalName(name)) {
    throw invalidCharacter(globalObject, `"${name}" is not a valid element local name`);
  }
};

// https://dom.spec.whatwg.org/#valid-attribute-local-name
exports.attributeLocalName = (globalObject, name) => {
  if (!exports.isValidAttributeLocalName(name)) {
    throw invalidCharacter(globalObject, `"${name}" is not a valid attribute local name`);
  }
};

// https://dom.spec.whatwg.org/#valid-doctype-name
exports.doctypeName = (globalObject, name) => {
  if (!exports.isValidDoctypeName(name)) {
    throw invalidCharacter(globalObject, `"${name}" is not a valid doctype name`);
  }
};

// https://dom.spec.whatwg.org/#validate-and-extract, context being "element" or "attribute".
exports.validateAndExtract = (globalObject, namespace, qualifiedName, context = "element") => {
  if (namespace === "") {
    namespace = null;
  }

  let prefix = null;
  let localName = qualifiedName;

  // Split at the first colon only: what follows is the local name, colons and all.
  const colonIndex = qualifiedName.indexOf(":");
  if (colonIndex !== -1) {
    prefix = qualifiedName.substring(0, colonIndex);
    localName = qualifiedName.substring(colonIndex + 1);

    if (!exports.isValidNamespacePrefix(prefix)) {
      throw invalidCharacter(globalObject, `"${prefix}" is not a valid namespace prefix`);
    }
  }

  if (context === "attribute") {
    exports.attributeLocalName(globalObject, localName);
  } else {
    exports.elementLocalName(globalObject, localName);
  }

  if (prefix !== null && namespace === null) {
    throw DOMException.create(globalObject, [
      "A namespace was given but a prefix was also extracted from the qualifiedName",
      "NamespaceError"
    ]);
  }

  if (prefix === "xml" && namespace !== XML_NS) {
    throw DOMException.create(globalObject, [
      "A prefix of \"xml\" was given but the namespace was not the XML namespace",
      "NamespaceError"
    ]);
  }

  if ((qualifiedName === "xmlns" || prefix === "xmlns") && namespace !== XMLNS_NS) {
    throw DOMException.create(globalObject, [
      "A prefix or qualifiedName of \"xmlns\" was given but the namespace was not the XMLNS namespace",
      "NamespaceError"
    ]);
  }

  if (namespace === XMLNS_NS && qualifiedName !== "xmlns" && prefix !== "xmlns") {
    throw DOMException.create(globalObject, [
      "The XMLNS namespace was given but neither the prefix nor qualifiedName was \"xmlns\"",
      "NamespaceError"
    ]);
  }

  return { namespace, prefix, localName };
};
