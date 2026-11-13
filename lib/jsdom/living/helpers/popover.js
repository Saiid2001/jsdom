"use strict";
const DOMException = require("../generated/DOMException");
const ToggleEvent = require("../generated/ToggleEvent");
const idlUtils = require("../generated/utils");
const { fireAnEvent } = require("./events");
const { asciiLowercase } = require("./strings");
const { domSymbolTree } = require("./internal-constants");
const { isFocusableAreaElement } = require("./focusing");
const { invalidateStyleCache } = require("./style-rules");
const { invalidateRendering } = require("./rendering-invalidation");
const { HTML_NS } = require("./namespaces");
const settimeoutPolyfill = require("./settimeout-polyfill");
const { isDisabled } = require("./form-controls");
const { nodeRoot } = require("./node");
const { isShadowInclusiveAncestor, shadowIncludingRoot } = require("./shadow-dom");

// The popover API and the parts of <dialog> it shares: toggle event tasks,
// the showing popover lists, and the focusing steps.
// https://html.spec.whatwg.org/multipage/popover.html
//
// There is no top layer to render into: an element "in the top layer" is
// recorded in a list on its document, which is what :modal, the popover lists
// and the stacking order read, and nothing is painted differently for it.

// https://html.spec.whatwg.org/multipage/popover.html#attr-popover
function popoverState(element) {
  if (element._namespaceURI !== HTML_NS) {
    return "none";
  }
  const value = element.getAttributeNS(null, "popover");
  return popoverStateOfValue(value);
}

function popoverStateOfValue(value) {
  if (value === null) {
    return "none";
  }
  const keyword = asciiLowercase(value);
  if (keyword === "" || keyword === "auto") {
    return "auto";
  }
  if (keyword === "hint") {
    return "hint";
  }
  return "manual";
}

function documentState(document) {
  if (!document._popoverState) {
    document._popoverState = {
      showingAutoPopoverList: [],
      showingHintPopoverList: [],
      // The auto popover the hint stack was opened from, if any: hiding it hides the hint stack too,
      // and hiding an auto popover the hint stack is not nested in leaves it showing.
      hintStackAnchor: null,
      topLayer: []
    };
  }
  return document._popoverState;
}

// https://html.spec.whatwg.org/multipage/document-sequences.html#fully-active
function isFullyActive(document) {
  const window = document._defaultView;
  return Boolean(window) && Boolean(window._document) && idlUtils.implForWrapper(window._document) === document;
}

function isShowing(element) {
  return element._popoverVisibilityState === "showing";
}

function addToTopLayer(element) {
  const { topLayer } = documentState(element._ownerDocument);
  removeFromList(topLayer, element);
  topLayer.push(element);
  invalidateRendering(element);
}

function removeFromTopLayer(element) {
  removeFromList(documentState(element._ownerDocument).topLayer, element);
  invalidateRendering(element);
}

function removeFromList(list, item) {
  const index = list.indexOf(item);
  if (index !== -1) {
    list.splice(index, 1);
  }
}

// A task on the event loop the page's own timers run on, so that it runs in order with the page's
// setTimeout(0) callbacks.
function queueTask(fn) {
  const handle = settimeoutPolyfill.setTimeout(fn, 0);
  return () => settimeoutPolyfill.clearTimeout(handle);
}

// https://html.spec.whatwg.org/multipage/popover.html#queue-a-popover-toggle-event-task and
// https://html.spec.whatwg.org/multipage/interactive-elements.html#queue-a-dialog-toggle-event-task: a
// pending toggle event absorbs the next one, keeping the first oldState.
function queueToggleEventTask(element, trackerKey, oldState, newState, source) {
  const tracker = element[trackerKey];
  if (tracker) {
    ({ oldState } = tracker);
    tracker.cancel();
    element[trackerKey] = null;
  }
  const cancel = queueTask(() => {
    element[trackerKey] = null;
    fireAnEvent("toggle", element, ToggleEvent, { oldState, newState, source });
  });
  element[trackerKey] = { cancel, oldState };
}

function fireBeforeToggle(element, oldState, newState, cancelable, source) {
  return fireAnEvent("beforetoggle", element, ToggleEvent, { cancelable, oldState, newState, source });
}

// https://html.spec.whatwg.org/multipage/popover.html#check-popover-validity
function checkPopoverValidity(element, expectedToBeShowing, throwExceptions, expectedDocument) {
  if (popoverState(element) === "none") {
    if (throwExceptions) {
      throw DOMException.create(element._globalObject, [
        "The element does not have a popover attribute.",
        "NotSupportedError"
      ]);
    }
    return false;
  }

  if ((expectedToBeShowing && !isShowing(element)) || (!expectedToBeShowing && isShowing(element))) {
    return false;
  }

  if (!element.isConnected ||
      (expectedDocument !== null && element._ownerDocument !== expectedDocument) ||
      (element._localName === "dialog" && element._isModal) ||
      !isFullyActive(element._ownerDocument)) {
    if (throwExceptions) {
      throw DOMException.create(element._globalObject, [
        "The popover is not connected, is a modal dialog, or its document is not fully active.",
        "InvalidStateError"
      ]);
    }
    return false;
  }

  return true;
}

function flatTreeParent(node) {
  if (node._assignedSlot) {
    return node._assignedSlot;
  }
  const parent = domSymbolTree.parent(node);
  if (parent && parent.nodeType === 11 && parent._host) {
    return parent._host;
  }
  return parent || null;
}

// https://html.spec.whatwg.org/multipage/popover.html#nearest-inclusive-open-popover
function nearestInclusiveOpenPopover(node) {
  for (; node; node = flatTreeParent(node)) {
    if (node.nodeType === 1) {
      const state = popoverState(node);
      if ((state === "auto" || state === "hint") && isShowing(node)) {
        return node;
      }
    }
  }
  return null;
}

// https://html.spec.whatwg.org/multipage/popover.html#topmost-popover-ancestor
function topmostPopoverAncestor(newPopover, popoverList, invoker, isPopover) {
  const positions = new Map();
  let index = 0;
  for (const popover of popoverList) {
    positions.set(popover, index++);
  }
  if (isPopover) {
    positions.set(newPopover, index++);
  }

  let topmost = null;
  const checkAncestor = candidate => {
    if (!candidate) {
      return;
    }
    let candidateAncestor = null;
    for (;;) {
      candidateAncestor = nearestInclusiveOpenPopover(candidate);
      if (candidateAncestor === null || !positions.has(candidateAncestor)) {
        return;
      }
      const ancestorState = popoverState(candidateAncestor);
      if (!isPopover || popoverState(newPopover) === ancestorState || ancestorState === "auto") {
        break;
      }
      candidate = flatTreeParent(candidateAncestor);
    }
    if (topmost === null || positions.get(topmost) < positions.get(candidateAncestor)) {
      topmost = candidateAncestor;
    }
  };

  checkAncestor(flatTreeParent(newPopover));
  checkAncestor(invoker);
  return topmost;
}

// https://html.spec.whatwg.org/multipage/popover.html#hide-popover-stack-until
function hidePopoverStackUntil(endpoint, popoverList, focusPreviousElement, fireEvents) {
  // Each pass hides the popover above endpoint; a popover whose hiding did not take
  // it off the list (an event handler showed it again) ends the loop.
  while (popoverList.length > 0) {
    const index = popoverList.indexOf(endpoint);
    const last = popoverList[popoverList.length - 1];
    if (last === endpoint || (endpoint !== null && index === -1)) {
      return;
    }
    hidePopover(last, focusPreviousElement, fireEvents, false, null);
    if (popoverList[popoverList.length - 1] === last) {
      return;
    }
  }
}

// https://html.spec.whatwg.org/multipage/popover.html#close-entire-popover-list
function closeEntirePopoverList(popoverList, focusPreviousElement, fireEvents) {
  hidePopoverStackUntil(null, popoverList, focusPreviousElement, fireEvents);
}

// https://html.spec.whatwg.org/multipage/popover.html#hide-all-popovers-until
function hideAllPopoversUntil(endpoint, focusPreviousElement, fireEvents) {
  if (endpoint.nodeType === 1 && !isShowing(endpoint)) {
    return;
  }
  const document = endpoint.nodeType === 9 ? endpoint : endpoint._ownerDocument;
  const state = documentState(document);

  if (endpoint.nodeType === 9) {
    closeEntirePopoverList(state.showingHintPopoverList, focusPreviousElement, fireEvents);
    closeEntirePopoverList(state.showingAutoPopoverList, focusPreviousElement, fireEvents);
    return;
  }

  if (state.showingHintPopoverList.includes(endpoint)) {
    hidePopoverStackUntil(endpoint, state.showingHintPopoverList, focusPreviousElement, fireEvents);
    return;
  }

  const autoList = state.showingAutoPopoverList;
  if (!autoList.includes(endpoint)) {
    return;
  }
  if (state.hintStackAnchor !== null && autoList.indexOf(state.hintStackAnchor) >= autoList.indexOf(endpoint)) {
    closeEntirePopoverList(state.showingHintPopoverList, focusPreviousElement, fireEvents);
  }
  hidePopoverStackUntil(endpoint, autoList, focusPreviousElement, fireEvents);
}

// https://html.spec.whatwg.org/multipage/popover.html#topmost-auto-popover
function topmostAutoOrHintPopover(document) {
  const { showingHintPopoverList, showingAutoPopoverList } = documentState(document);
  if (showingHintPopoverList.length > 0) {
    return showingHintPopoverList[showingHintPopoverList.length - 1];
  }
  if (showingAutoPopoverList.length > 0) {
    return showingAutoPopoverList[showingAutoPopoverList.length - 1];
  }
  return null;
}

function setVisibility(element, visibility) {
  element._popoverVisibilityState = visibility;
  invalidateStyleCache(element);
  invalidateRendering(element);
}

// https://html.spec.whatwg.org/multipage/popover.html#show-popover
function showPopover(element, throwExceptions, invoker) {
  if (!checkPopoverValidity(element, false, throwExceptions, null)) {
    return;
  }

  const document = element._ownerDocument;
  const state = documentState(document);
  const nestedShow = element._popoverShowingOrHiding;
  const fireEvents = !nestedShow;
  element._popoverShowingOrHiding = true;
  const cleanup = () => {
    if (!nestedShow) {
      element._popoverShowingOrHiding = false;
    }
  };

  try {
    if (!fireBeforeToggle(element, "closed", "open", true, invoker)) {
      return;
    }

    if (!checkPopoverValidity(element, false, throwExceptions, document)) {
      return;
    }

    let shouldRestoreFocus = false;
    const originalType = popoverState(element);
    let stackToAppendTo = null;

    // A popover nested in a showing hint popover joins the hint stack whatever its own type. A hint
    // popover otherwise starts a new hint stack and leaves the auto popovers showing; an auto popover
    // closes the hint stack and the auto popovers it is not nested in.
    if (originalType === "auto" || originalType === "hint") {
      const hintAncestor = topmostPopoverAncestor(element, state.showingHintPopoverList, invoker, false);
      if (hintAncestor !== null) {
        hideAllPopoversUntil(hintAncestor, false, fireEvents);
        stackToAppendTo = "hint";
      } else if (originalType === "hint") {
        closeEntirePopoverList(state.showingHintPopoverList, false, fireEvents);
        state.hintStackAnchor = topmostPopoverAncestor(element, state.showingAutoPopoverList, invoker, false);
        stackToAppendTo = "hint";
      } else {
        closeEntirePopoverList(state.showingHintPopoverList, false, fireEvents);
        const ancestor = topmostPopoverAncestor(element, state.showingAutoPopoverList, invoker, true);
        hideAllPopoversUntil(ancestor || document, false, fireEvents);
        stackToAppendTo = "auto";
      }
    }

    if (originalType === "auto" || originalType === "hint") {
      if (originalType !== popoverState(element) || !checkPopoverValidity(element, false, throwExceptions, document)) {
        return;
      }
      if (topmostAutoOrHintPopover(document) === null) {
        shouldRestoreFocus = true;
      }
    }

    if (stackToAppendTo === "auto") {
      element._openedInPopoverMode = "auto";
      state.showingAutoPopoverList.push(element);
    } else if (stackToAppendTo === "hint") {
      element._openedInPopoverMode = "hint";
      state.showingHintPopoverList.push(element);
    } else {
      element._openedInPopoverMode = "manual";
    }

    element._popoverInvoker = invoker;
    element._popoverPreviouslyFocusedElement = null;
    const originallyFocusedElement = document._lastFocusedElement;
    addToTopLayer(element);
    setVisibility(element, "showing");

    popoverFocusingSteps(element);

    if (shouldRestoreFocus && popoverState(element) !== "none") {
      element._popoverPreviouslyFocusedElement = originallyFocusedElement;
    }

    queueToggleEventTask(element, "_popoverToggleTaskTracker", "closed", "open", invoker);
  } finally {
    cleanup();
  }
}

// https://html.spec.whatwg.org/multipage/popover.html#hide-popover-algorithm
function hidePopover(element, focusPreviousElement, fireEvents, throwExceptions, source) {
  if (!checkPopoverValidity(element, true, throwExceptions, null)) {
    return;
  }

  const document = element._ownerDocument;
  const state = documentState(document);
  const nestedHide = element._popoverShowingOrHiding;
  element._popoverShowingOrHiding = true;
  if (nestedHide) {
    fireEvents = false;
  }

  try {
    if (element._openedInPopoverMode === "auto" || element._openedInPopoverMode === "hint") {
      hideAllPopoversUntil(element, focusPreviousElement, fireEvents);
      if (!checkPopoverValidity(element, true, throwExceptions, null)) {
        return;
      }
    }

    const autoList = state.showingAutoPopoverList;
    const autoPopoverListContainsElement = autoList[autoList.length - 1] === element;

    element._popoverInvoker = null;

    if (fireEvents) {
      fireBeforeToggle(element, "open", "closed", false, source);
      if (autoPopoverListContainsElement && autoList[autoList.length - 1] !== element) {
        hideAllPopoversUntil(element, focusPreviousElement, false);
      }
      if (!checkPopoverValidity(element, true, throwExceptions, null)) {
        return;
      }
    }

    finishHiding(element, state);

    if (fireEvents) {
      queueToggleEventTask(element, "_popoverToggleTaskTracker", "open", "closed", source);
    }

    const previouslyFocused = element._popoverPreviouslyFocusedElement;
    if (previouslyFocused) {
      element._popoverPreviouslyFocusedElement = null;
      if (focusPreviousElement && containsFocus(element)) {
        previouslyFocused.focus();
      }
    }
  } finally {
    if (!nestedHide) {
      element._popoverShowingOrHiding = false;
    }
  }
}

function finishHiding(element, state) {
  removeFromTopLayer(element);
  removeFromList(state.showingAutoPopoverList, element);
  removeFromList(state.showingHintPopoverList, element);
  if (state.showingHintPopoverList.length === 0 || state.hintStackAnchor === element) {
    state.hintStackAnchor = null;
  }
  element._openedInPopoverMode = null;
  setVisibility(element, "hidden");
}

// https://html.spec.whatwg.org/multipage/popover.html#the-popover-attribute: the HTML element removing
// steps. Removal hides the popover with no events, and the popovers nested above it go with it. The
// hide popover algorithm cannot do this here: a removed element is no longer connected, which it checks.
function hidePopoverOnRemoval(element) {
  if (!isShowing(element)) {
    return;
  }
  const state = documentState(element._ownerDocument);
  for (const list of [state.showingHintPopoverList, state.showingAutoPopoverList]) {
    const index = list.indexOf(element);
    if (index !== -1) {
      for (const above of list.slice(index + 1).reverse()) {
        if (above.isConnected) {
          hidePopover(above, false, false, false, null);
        } else {
          hidePopoverOnRemoval(above);
        }
      }
    }
  }
  if (state.hintStackAnchor === element) {
    closeEntirePopoverList(state.showingHintPopoverList, false, false);
  }
  element._popoverInvoker = null;
  element._popoverPreviouslyFocusedElement = null;
  finishHiding(element, state);
}

function containsFocus(element) {
  const focused = element._ownerDocument._lastFocusedElement;
  for (let node = focused; node; node = flatTreeParent(node)) {
    if (node === element) {
      return true;
    }
  }
  return false;
}

// https://html.spec.whatwg.org/multipage/interaction.html#autofocus-delegate
function autofocusDelegate(root) {
  for (const descendant of domSymbolTree.treeIterator(root)) {
    if (descendant === root || descendant.nodeType !== 1) {
      continue;
    }
    if (descendant.hasAttributeNS(null, "autofocus") && isFocusableAreaElement(descendant)) {
      return descendant;
    }
  }
  return null;
}

// https://html.spec.whatwg.org/multipage/interaction.html#focus-delegate
function focusDelegate(root) {
  const autofocus = autofocusDelegate(root);
  if (autofocus !== null) {
    return autofocus;
  }
  for (const descendant of domSymbolTree.treeIterator(root)) {
    if (descendant !== root && descendant.nodeType === 1 && isFocusableAreaElement(descendant)) {
      return descendant;
    }
  }
  return null;
}

// https://html.spec.whatwg.org/multipage/interactive-elements.html#dialog-focusing-steps
function dialogFocusingSteps(dialog) {
  let control = null;
  if (dialog.hasAttributeNS(null, "autofocus")) {
    control = dialog;
  }
  if (control === null) {
    control = focusDelegate(dialog);
  }
  if (control === null) {
    control = dialog;
  }
  if (isFocusableAreaElement(control)) {
    control.focus();
  }
}

// https://html.spec.whatwg.org/multipage/popover.html#popover-focusing-steps
function popoverFocusingSteps(subject) {
  if (subject._localName === "dialog") {
    dialogFocusingSteps(subject);
    return;
  }
  const control = subject.hasAttributeNS(null, "autofocus") ? subject : autofocusDelegate(subject);
  if (control !== null && isFocusableAreaElement(control)) {
    control.focus();
  }
}

// https://html.spec.whatwg.org/multipage/popover.html#popover-target-element
function popoverTargetElement(node) {
  if (!isPopoverInvoker(node)) {
    return null;
  }
  if (isDisabled(node)) {
    return null;
  }
  if (node.form !== null && isSubmitButton(node)) {
    return null;
  }
  const popover = popoverTargetAssociatedElement(node);
  if (popover === null || popoverState(popover) === "none") {
    return null;
  }
  return popover;
}

function isPopoverInvoker(node) {
  if (node._localName === "button") {
    return true;
  }
  return node._localName === "input" && ["submit", "reset", "image", "button"].includes(node.type);
}

function isSubmitButton(node) {
  return node.type === "submit" || node.type === "image";
}

// https://html.spec.whatwg.org/multipage/popover.html#popover-target-attribute-activation-behavior
function popoverTargetActivationBehavior(node, eventTarget) {
  const popover = popoverTargetElement(node);
  if (popover === null) {
    return;
  }
  if (eventTarget && isShadowInclusiveAncestor(popover, eventTarget) &&
      isShadowInclusiveAncestor(node, popover) && node !== popover) {
    return;
  }
  const action = node.popoverTargetAction;
  if (action === "show" && isShowing(popover)) {
    return;
  }
  if (action === "hide" && !isShowing(popover)) {
    return;
  }
  if (isShowing(popover)) {
    hidePopover(popover, true, true, false, node);
  } else if (checkPopoverValidity(popover, false, false, null)) {
    showPopover(popover, false, node);
  }
}

// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-element, for the
// popovertarget attribute. An element set through popoverTargetElement is kept until the content
// attribute is next set by anything else.
function popoverTargetAssociatedElement(node) {
  const explicit = node._explicitlySetPopoverTarget;
  if (explicit) {
    return shadowIncludingRoot(explicit) === shadowIncludingRoot(node) ? explicit : null;
  }
  const id = node.getAttributeNS(null, "popovertarget");
  if (id === null || id === "") {
    return null;
  }
  const root = nodeRoot(node);
  for (const candidate of domSymbolTree.treeIterator(root)) {
    if (candidate.nodeType === 1 && candidate.getAttributeNS(null, "id") === id) {
      return candidate;
    }
  }
  return null;
}

function setPopoverTargetElement(node, element) {
  node._settingPopoverTargetElement = true;
  try {
    if (element === null) {
      node.removeAttributeNS(null, "popovertarget");
    } else {
      node.setAttributeNS(null, "popovertarget", "");
    }
  } finally {
    node._settingPopoverTargetElement = false;
  }
  node._explicitlySetPopoverTarget = element;
}

// Content attribute changes not made by the popoverTargetElement setter drop the element it set.
function popoverTargetAttributeChanged(node) {
  if (!node._settingPopoverTargetElement) {
    node._explicitlySetPopoverTarget = null;
  }
}

module.exports = {
  popoverState,
  popoverStateOfValue,
  documentState,
  isFullyActive,
  isShowing,
  addToTopLayer,
  removeFromTopLayer,
  queueTask,
  queueToggleEventTask,
  fireBeforeToggle,
  checkPopoverValidity,
  hideAllPopoversUntil,
  topmostPopoverAncestor,
  showPopover,
  hidePopover,
  hidePopoverOnRemoval,
  dialogFocusingSteps,
  popoverTargetActivationBehavior,
  popoverTargetAssociatedElement,
  setPopoverTargetElement,
  popoverTargetAttributeChanged
};
