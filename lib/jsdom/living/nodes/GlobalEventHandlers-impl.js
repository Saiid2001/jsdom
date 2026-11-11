"use strict";

const { appendHandler, createEventAccessor } = require("../helpers/create-event-accessor");

// Must be kept in sync with GlobalEventHandlers.webidl.
const events = new Set([
  "abort",
  "auxclick",
  "beforeinput",
  "beforematch",
  "beforetoggle",
  "blur",
  "cancel",
  "canplay",
  "canplaythrough",
  "change",
  "click",
  "close",
  "command",
  "contextlost",
  "contextmenu",
  "contextrestored",
  "copy",
  "cuechange",
  "cut",
  "dblclick",
  "drag",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "durationchange",
  "emptied",
  "ended",
  "error",
  "focus",
  "formdata",
  "input",
  "invalid",
  "keydown",
  "keypress",
  "keyup",
  "load",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "mousedown",
  "mouseenter",
  "mouseleave",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "paste",
  "pause",
  "play",
  "playing",
  "progress",
  "ratechange",
  "reset",
  "resize",
  "scroll",
  "scrollend",
  "securitypolicyviolation",
  "seeked",
  "seeking",
  "select",
  "slotchange",
  "stalled",
  "submit",
  "suspend",
  "timeupdate",
  "toggle",
  "volumechange",
  "waiting",
  "webkitanimationend",
  "webkitanimationiteration",
  "webkitanimationstart",
  "webkittransitionend",
  "wheel",
  "touchstart",
  "touchend",
  "touchmove",
  "touchcancel",
  "animationstart",
  "animationiteration",
  "animationend",
  "animationcancel",
  "transitionrun",
  "transitionstart",
  "transitionend",
  "transitioncancel",
  "gotpointercapture",
  "lostpointercapture",
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "pointerover",
  "pointerout",
  "pointerenter",
  "pointerleave",
  "selectstart",
  "selectionchange"
]);

// The event handlers whose event type is not their name without "on".
// https://html.spec.whatwg.org/multipage/webappapis.html#event-handlers-on-elements,-document-objects,-and-window-objects
const eventTypes = {
  webkitanimationend: "webkitAnimationEnd",
  webkitanimationiteration: "webkitAnimationIteration",
  webkitanimationstart: "webkitAnimationStart",
  webkittransitionend: "webkitTransitionEnd"
};

class GlobalEventHandlersImpl {
  _initGlobalEvents() {
    this._registeredHandlers = new Set();
    this._eventHandlers = Object.create(null);
  }

  _getEventHandlerTarget() {
    return this;
  }

  _getEventHandlerFor(event) {
    const target = this._getEventHandlerTarget(event);
    if (!target) {
      return null;
    }

    return target._eventHandlers[event];
  }

  _setEventHandlerFor(event, handler) {
    const target = this._getEventHandlerTarget(event);
    if (!target) {
      return;
    }

    if (!target._registeredHandlers.has(event) && handler !== null) {
      target._registeredHandlers.add(event);
      appendHandler(target, event, eventTypes[event]);
    }
    target._eventHandlers[event] = handler;
  }

  _globalEventChanged(event) {
    const propName = "on" + event;
    if (!(propName in this)) {
      return;
    }

    // Kept whatever document the element is in, and compiled only where
    // scripts run (getCurrentEventHandlerValue): an element made in a document
    // that runs none -- a template's contents, a DOMParser document -- carries
    // its handlers into the document it is adopted into, as in a browser.
    const val = this.getAttributeNS(null, propName);
    const handler = val === null ? null : { body: val };
    this._setEventHandlerFor(event, handler);
  }
}

for (const event of events) {
  createEventAccessor(GlobalEventHandlersImpl.prototype, event);
}

module.exports = {
  implementation: GlobalEventHandlersImpl
};
