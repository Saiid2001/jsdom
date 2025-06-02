"use strict";

const DOMException = require("../generated/DOMException");
const { serializeURL } = require("whatwg-url");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const FormData = require("../generated/FormData");
const { domSymbolTree } = require("../helpers/internal-constants");
const { fireAnEvent } = require("../helpers/events");
const { formOwner, isListed, isSubmittable, isSubmitButton, isButton } = require("../helpers/form-controls");
const HTMLFormControlsCollection = require("../generated/HTMLFormControlsCollection");
const notImplemented = require("../../browser/not-implemented");
const { parseURLToResultingURLRecord } = require("../helpers/document-base-url");
const SubmitEvent = require("../generated/SubmitEvent");
const { implSymbol } = require("../generated/utils");
const xWWWFormUrlEncoded = require("../serializers/xWWWFormUrlEncoded");
const MultipartForm = require("../serializers/MultipartForm");
const PlainText = require("../serializers/PlainText");
const { navigate } = require("../window/navigation");

const encTypes = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain"
]);

const methods = new Set([
  "get",
  "post",
  "dialog"
]);

const constraintValidationPositiveResult = Symbol("positive");
const constraintValidationNegativeResult = Symbol("negative");

class Entry {

  constructor(name, value) {
    this.name = name;

    if (typeof value === "string") {
      this.value = value;
    }
    else {
      // TODO: implement blob or file based value
      notImplemented("Entry value must be a string, blob or file", this._ownerDocument._defaultView);
      this.value = "";
    }

  }

}

class HTMLFormElementImpl extends HTMLElementImpl {
  _descendantAdded(parent, child) {
    const form = this;
    for (const el of domSymbolTree.treeIterator(child)) {
      if (typeof el._changedFormOwner === "function") {
        el._changedFormOwner(form);
      }
    }

    super._descendantAdded(parent, child);
  }

  _descendantRemoved(parent, child) {
    for (const el of domSymbolTree.treeIterator(child)) {
      if (typeof el._changedFormOwner === "function") {
        el._changedFormOwner(null);
      }
    }

    super._descendantRemoved(parent, child);
  }

  _getSubmittableElementNodes() {
    return domSymbolTree.treeToArray(this.getRootNode({}), {
      filter: node => {
        if (!isSubmittable(node)) {
          return false;
        }

        return formOwner(node) === this;
      }
    });
  }

  _getElementNodes() {
    return domSymbolTree.treeToArray(this.getRootNode({}), {
      filter: node => {
        if (!isListed(node) || (node._localName === "input" && node.type === "image")) {
          return false;
        }

        return formOwner(node) === this;
      }
    });
  }

  // https://html.spec.whatwg.org/multipage/forms.html#dom-form-elements
  get elements() {
    return HTMLFormControlsCollection.createImpl(this._globalObject, [], {
      element: this.getRootNode({}),
      query: () => this._getElementNodes()
    });
  }

  get length() {
    return this.elements.length;
  }

  // https://html.spec.whatwg.org/multipage/links.html#cannot-navigate
  _cannotNavigate() {

    // An element element cannot navigate if any of the following are true:
    // element's node document is not fully active
    // A Document d is said to be fully active when d is the active document of a navigable navigable, and either navigable is a top-level traversable or navigable's container document is fully active.

    return !this.ownerDocument._isFullyActive();

  }

  _doRequestSubmit(submitter) {
    if (!this.isConnected) {
      return;
    }

    this.requestSubmit(submitter);
  }

  submit() {
    
    if (!this.isConnected) {
      throw DOMException.create(this._globalObject, [
        "Failed to execute 'submit' on 'HTMLFormElement': The form element is not connected to a Document.",
        "InvalidStateError"
      ]);
    }

    // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-algorithm
    // Step 6.1: If the form has a submit button, then set submitter to that button.
    this.requestSubmit(null, true);
  }

  _constructingEntryList = false;
  _firingSubmissionEvents = false;

  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#selecting-a-form-submission-encoding
  _characterEncoding() {

    return this._ownerDocument._getEncodingForLabel(this._ownerDocument.characterSet);

  }

  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set
  _constructEntryList(submitter) {

    if (this._constructingEntryList) return null;

    this._constructingEntryList = true;

    const formData = FormData.createImpl(this._globalObject, [this, submitter]);

    fireAnEvent("formdata", this, undefined, { bubbles: true, cancelable: false, formData });

    this._constructingEntryList = false;

    return formData._entries.map(entry => entry);

    // deprecated

    let controls = this._getSubmittableElementNodes();

    // 5.
    for (const el of controls) {

      // cases to skip
      if (el.closest('datalist')) continue;
      if (el.disabled) continue;
      if (isButton(el) && !isSubmitButton(el, submitter)) continue;
      if (el._localName === "input" && (el.type === "checkbox" || el.type === "radio") && !el.checked) {
          continue;
        }

        // TODO: implement  2. If the field element is an input element whose type attribute is in the Image Button state ... 

        // TODO: If the field is a form-associated custom element, then perform the entry construction algorithm given field and entry list, then continue.

        if (!el.name || el.name === "") {
          // If the field element has no name, then continue.
          continue;
        } 

        let name = el.name;

        // handle select
        if (el._localName === 'select') {
          for (const option of el.options) {
            if (option.selected && !option.disabled) {
              formData.append(name, option.value);
            }
          }
        }

        // handle radio
        else if (el._localName === 'input' && (el.type === 'radio' || el.type === 'checkbox') && el.checked) {
          formData.append(name, el.value || "on");
        }

        // skip types we cannot handle
        else if (el._localName === 'input' && (el.type === 'file' || el.type === 'reset')) {
          // skip these types
          notImplemented(`HTMLFormElement._constructEntryList: input type ${el.type} is not supported`, this._ownerDocument._defaultView);
          continue;
        }

        // skip _charset_ input
        else if (el._localName === 'input' && el.type === '_charset_') {
          // skip this type
          notImplemented("HTMLFormElement._constructEntryList: input type _charset_ is not supported", this._ownerDocument._defaultView);
          continue;
        }

        else {
          if (el.value && typeof el.value == 'string') {
            formData.append(name, el.value);
          }
        }

        // TODO: ignore If the element has a dirname attribute, that attribute's value is not the empty string, and the element is an auto-directionality form-associated element

      }

      // fire event formdata
      fireAnEvent("formdata", this, undefined, { bubbles: true, cancelable: false, formData });

    this._constructingEntryList = false;

    return formData._entries;

      
    }
  

  _plannedNavigation = null;

  _mutateActionURL(entryList, target, method, encoding) {

    const queryString = xWWWFormUrlEncoded.serialize(entryList, encoding);
    let actionURL = this.action;
    if (actionURL.includes("?")) {
      actionURL = actionURL.split("?")[0];
    }
    if (queryString) {
      actionURL += "?" + queryString;
    }
    this._plannedNavigation = {
      url: actionURL,
      target,
      method,
      encoding
    };

    navigate(
      this._ownerDocument._defaultView,
      this._plannedNavigation.url,
      {},
      {
        target: this._plannedNavigation.target,
        method: this._plannedNavigation.method,
        encoding: this._plannedNavigation.encoding,
        body: this._plannedNavigation.body
      }
    )
  }

  _submitAsEntityBody(entryList, target, method, encoding) {

    function _navigate(headers = {}) {

      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['Content-Type'] = this.enctype;
      }

      navigate(
      this._ownerDocument._defaultView,
      this._plannedNavigation.url,
      {},
      {
        target: this._plannedNavigation.target,
        method: this._plannedNavigation.method,
        encoding: this._plannedNavigation.encoding,
        body: this._plannedNavigation.body,
        headers
        
      }
    )
    }

    switch (this.enctype) {

      case "application/x-www-form-urlencoded":
        const queryString = xWWWFormUrlEncoded.serialize(entryList, encoding);
        if (queryString) {
          this._plannedNavigation = {
            url: this.action,
            target,
            method,
            encoding,
            body: queryString
          };
          _navigate.call(this);
        } else {
          notImplemented("HTMLFormElement._submitAsEntityBody: no data to submit", this._ownerDocument._defaultView);
        }

      break;

      case "multipart/form-data":
        MultipartForm.serialize(entryList, encoding).then(formBody => {
        this._plannedNavigation = {
          url: this.action,
          target,
          method,
          encoding,
          body: formBody.buffer // the XHR will handle the transformation to multipart/form-data
        }
        
        _navigate.call(this, formBody.headers
        );

        }).catch(err => {
          notImplemented("HTMLFormElement._submitAsEntityBody: multipart/form-data serialization failed: " + err.message, this._ownerDocument._defaultView);
        }
        );

      break;
      case "text/plain":
        const textBody = PlainText.serialize(entryList, encoding);
        if (textBody) {
          this._plannedNavigation = {
            url: this.action,
            target,
            method,
            encoding,
            body: textBody
          };
          _navigate.call(this);
        }
        else {
          notImplemented("HTMLFormElement._submitAsEntityBody: no data to submit", this._ownerDocument._defaultView);
        }

      break;

      default:
        notImplemented("HTMLFormElement._submitAsEntityBody: enctype " + this.enctype + " is not supported", this._ownerDocument._defaultView);
        return;
    }

    if (this._cannotNavigate()) return;

    
  }

  requestSubmit(submitter = null, fromSubmit = false) {
    if (submitter !== null) {
      if (!isSubmitButton(submitter)) {
        throw new TypeError("The specified element is not a submit button");
      }
      if (submitter.form !== this) {
        throw DOMException.create(this._globalObject, [
          "The specified element is not owned by this form element",
          "NotFoundError"
        ]);
      }
    }

        if (this._cannotNavigate()) return;
    if (this._constructingEntryList) return;

    // IGNORE: If form document's active sandboxing flag set has its sandboxed forms browsing context flag set, then return.

    if (!fromSubmit) {
      if (this._firingSubmissionEvents) return;
      this._firingSubmissionEvents = true;
    }

    // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#form-submission-algorithm
    // Step 6.3: if form doesn't have the 'novalidate' attribute, validate it and abort submission if form is invalid
    if (!this.hasAttributeNS(null, "novalidate") && !this.reportValidity()) {
      this._firingSubmissionEvents = false;
      return;
    }


    if (!fireAnEvent("submit", this, SubmitEvent, { bubbles: true, cancelable: true, submitter })) {
      return;
    }

    this._firingSubmissionEvents = false;


    const encoding = this._characterEncoding();

    const entryList = this._constructEntryList(submitter, encoding);

    if (!entryList) {
      throw DOMException.create(this._globalObject, [
        "Failed to execute 'requestSubmit' on 'HTMLFormElement': The form data set could not be constructed.",
        "InvalidStateError"
      ]);
    }

    if (this._cannotNavigate()) return;

    let method = submitter?.formMethod || this.method;

    if (!method) method = "GET";
    method = method.toUpperCase();

    // TODO: implement dialog method
    if (method !== "GET" && method !== "POST") {
      notImplemented("HTMLFormElement.prototype.requestSubmit: method must be GET or POST", this._ownerDocument._defaultView);
      return;
    }

    // form target 
    // TODO: implement other targets
    let target = "_self";
    let scheme = this.action.split(":")[0].toLowerCase();

    if (scheme !== "http" && scheme !== "https") {
      notImplemented("HTMLFormElement.prototype.requestSubmit: only http and https schemes are supported", this._ownerDocument._defaultView);
      return;
    }


    if (method === "GET" ) {
      this._mutateActionURL(entryList, target, method, encoding);
    } 
    else if (method === "POST") {
      this._submitAsEntityBody(entryList, target, method, encoding);
    }

    notImplemented("HTMLFormElement.prototype.requestSubmit", this._ownerDocument._defaultView);
  }

  _doReset() {
    if (!this.isConnected) {
      return;
    }

    this.reset();
  }

  reset() {
    if (!fireAnEvent("reset", this, undefined, { bubbles: true, cancelable: true })) {
      return;
    }

    for (const el of this.elements) {
      if (typeof el._formReset === "function") {
        el._formReset();
      }
    }
  }

  get method() {
    let method = this.getAttributeNS(null, "method");
    if (method) {
      method = method.toLowerCase();
    }

    if (methods.has(method)) {
      return method;
    }
    return "get";
  }

  set method(V) {
    this.setAttributeNS(null, "method", V);
  }

  get enctype() {
    let type = this.getAttributeNS(null, "enctype");
    if (type) {
      type = type.toLowerCase();
    }

    if (encTypes.has(type)) {
      return type;
    }
    return "application/x-www-form-urlencoded";
  }

  set enctype(V) {
    this.setAttributeNS(null, "enctype", V);
  }

  get action() {
    const attributeValue = this.getAttributeNS(null, "action");
    if (attributeValue === null || attributeValue === "") {
      return this._ownerDocument.URL;
    }
    const urlRecord = parseURLToResultingURLRecord(attributeValue, this._ownerDocument);
    if (urlRecord === null) {
      return attributeValue;
    }
    return serializeURL(urlRecord);
  }

  set action(V) {
    this.setAttributeNS(null, "action", V);
  }

  // If the checkValidity() method is invoked, the user agent must statically validate the
  // constraints of the form element, and return true if the constraint validation returned
  // a positive result, and false if it returned a negative result.
  checkValidity() {
    return this._staticallyValidateConstraints().result === constraintValidationPositiveResult;
  }

  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#interactively-validate-the-constraints
  reportValidity() {
    return this.checkValidity();
  }

  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#statically-validate-the-constraints
  _staticallyValidateConstraints() {
    const controls = [];
    for (const el of this.elements) {
      if (el.form === this && isSubmittable(el)) {
        controls.push(el);
      }
    }

    const invalidControls = [];

    for (const control of controls) {
      if (control._isCandidateForConstraintValidation() && !control._satisfiesConstraints()) {
        invalidControls.push(control);
      }
    }

    if (invalidControls.length === 0) {
      return { result: constraintValidationPositiveResult };
    }

    const unhandledInvalidControls = [];
    for (const invalidControl of invalidControls) {
      const notCancelled = fireAnEvent("invalid", invalidControl, undefined, { cancelable: true });
      if (notCancelled) {
        unhandledInvalidControls.push(invalidControl);
      }
    }

    return { result: constraintValidationNegativeResult, unhandledInvalidControls };
  }
}

module.exports = {
  implementation: HTMLFormElementImpl
};
