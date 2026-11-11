// https://w3c.github.io/uievents/#legacy-interface-TextEvent
[Exposed=Window]
interface TextEvent : UIEvent {
  readonly attribute DOMString data;
  undefined initTextEvent(DOMString type,
                          optional boolean bubbles = false,
                          optional boolean cancelable = false,
                          optional Window? view = null,
                          optional DOMString data = "undefined");
};
