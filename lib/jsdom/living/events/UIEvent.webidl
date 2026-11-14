// https://w3c.github.io/uievents/#idl-uievent
[Exposed=Window]
interface UIEvent : Event {
  constructor(DOMString type, optional UIEventInit eventInitDict = {});
  readonly attribute Window? view;
  readonly attribute long detail;
};

// The target's pseudo-element when an event is dispatched at one, as Chromium ships it. Its type there is
// CSSPseudoElement?, an EventTarget jsdom does not implement; no event is dispatched at a pseudo-element, so it is
// always null.
partial interface UIEvent {
  readonly attribute EventTarget? pseudoTarget;
};

// https://w3c.github.io/uievents/#idl-uieventinit
dictionary UIEventInit : EventInit {
  Window? view = null;
  long detail = 0;
};

// https://w3c.github.io/uievents/#event-modifier-initializers
dictionary EventModifierInit : UIEventInit {
  boolean ctrlKey = false;
  boolean shiftKey = false;
  boolean altKey = false;
  boolean metaKey = false;

  boolean modifierAltGraph = false;
  boolean modifierCapsLock = false;
  boolean modifierFn = false;
  boolean modifierFnLock = false;
  boolean modifierHyper = false;
  boolean modifierNumLock = false;
  boolean modifierScrollLock = false;
  boolean modifierSuper = false;
  boolean modifierSymbol = false;
  boolean modifierSymbolLock = false;
};

// https://github.com/w3c/uievents/issues/133
partial interface UIEvent {
    // Deprecated in this specification
    undefined initUIEvent(DOMString typeArg,
                          optional boolean bubblesArg = false,
                          optional boolean cancelableArg = false,
                          optional Window? viewArg = null,
                          optional long detailArg = 0);
};

// https://w3c.github.io/uievents/#legacy-interface-UIEvent
partial interface UIEvent {
  // The following support legacy user agents
  readonly attribute unsigned long which;
};

// https://w3c.github.io/uievents/#legacy-dictionary-UIEventInit
partial dictionary UIEventInit {
  unsigned long which = 0;
};
