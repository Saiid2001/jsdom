"use strict";
const namedPropertiesTracker = require("../named-properties-tracker");
const NODE_TYPE = require("./node-type");
const HTMLCollection = require("./generated/HTMLCollection");
const idlUtils = require("./generated/utils");
const { HTML_NS } = require("./helpers/namespaces");
const { formOwner, isListed } = require("./helpers/form-controls");
const { treeOrderSorter } = require("../utils");

// A document's named items and a form's named controls, as properties of the
// document and the form, tracked the way the window's named properties are:
// a getter defined on the object for each name in use, removed when the last
// element of that name goes. A name the object already has -- a built-in
// property -- is left alone, where the specification has both objects
// override them.
// https://html.spec.whatwg.org/multipage/dom.html#dom-document-nameditem
// https://html.spec.whatwg.org/multipage/forms.html#the-form-element

const BY_NAME = new Set(["embed", "form", "iframe", "img", "object"]);

function isHTML(element) {
  return element.nodeType === NODE_TYPE.ELEMENT_NODE && element._namespaceURI === HTML_NS;
}

function exposedByName(element) {
  return BY_NAME.has(element._localName);
}

// An object by its id, and an image by its id where it also has a name.
function exposedById(element) {
  return element._localName === "object" ||
    (element._localName === "img" && Boolean(element.getAttributeNS(null, "name")));
}

function documentResolver(documentWrapper, name, values) {
  const documentImpl = idlUtils.implForWrapper(documentWrapper);

  const query = () => [...values()].filter(element => element._attached &&
    element._ownerDocument === documentImpl &&
    ((exposedByName(element) && element.getAttributeNS(null, "name") === name) ||
      (exposedById(element) && element.getAttributeNS(null, "id") === name))).sort(treeOrderSorter);

  const found = query();

  if (found.length === 0) {
    return undefined;
  }

  if (found.length === 1) {
    const [element] = found;

    return element._localName === "iframe" && element.contentWindow ?
      element.contentWindow :
      idlUtils.wrapperForImpl(element);
  }

  return HTMLCollection.create(documentImpl._globalObject, [], {
    element: documentImpl.documentElement ?? documentImpl,
    query
  });
}

function formResolver(formWrapper, name) {
  const item = idlUtils.implForWrapper(formWrapper).elements.namedItem(name);

  return item === null ? undefined : idlUtils.wrapperForImpl(item);
}

function trackerFor(impl, resolver) {
  const wrapper = idlUtils.wrapperForImpl(impl);

  if (!wrapper) {
    return null;
  }

  return namedPropertiesTracker.get(wrapper) ?? namedPropertiesTracker.create(wrapper, wrapper, resolver);
}

// The names an element is tracked under on each object, so the same pairs can
// be untracked when it goes or a name changes.
function track(element) {
  const names = [];

  if (exposedByName(element)) {
    names.push(["document", element.getAttributeNS(null, "name")]);
  }

  if (exposedById(element)) {
    names.push(["document", element.getAttributeNS(null, "id")]);
  }

  if (names.length > 0) {
    const tracker = trackerFor(element._ownerDocument, documentResolver);

    for (const [, name] of names) {
      tracker?.track(name, element);
    }
  }

  if (isListed(element) && !(element._localName === "input" && element.type === "image")) {
    const form = formOwner(element);

    if (form) {
      const tracker = trackerFor(form, formResolver);

      element._namedForm = form;
      tracker?.track(element.getAttributeNS(null, "id"), element);
      tracker?.track(element.getAttributeNS(null, "name"), element);
    }
  }
}

function untrack(element, attribute, value) {
  const documentTracker = namedPropertiesTracker.get(idlUtils.wrapperForImpl(element._ownerDocument));

  if (documentTracker && ((attribute === "name" && exposedByName(element)) ||
    (attribute === "id" && exposedById(element)))) {
    documentTracker.untrack(value, element);
  }

  if (element._namedForm) {
    namedPropertiesTracker.get(idlUtils.wrapperForImpl(element._namedForm))?.untrack(value, element);
  }
}

exports.nodeAttachedToDocument = node => {
  if (isHTML(node)) {
    track(node);
  }
};

exports.nodeDetachedFromDocument = node => {
  if (!isHTML(node)) {
    return;
  }

  untrack(node, "name", node.getAttributeNS(null, "name"));
  untrack(node, "id", node.getAttributeNS(null, "id"));
  node._namedForm = null;
};

exports.elementAttributeModified = (element, name, value, oldValue) => {
  if (!element._attached || !isHTML(element) || (name !== "name" && name !== "id")) {
    return;
  }

  untrack(element, name, oldValue);
  track(element);
};
