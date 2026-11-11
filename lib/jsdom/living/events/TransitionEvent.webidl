// https://drafts.csswg.org/css-transitions/#interface-transitionevent
[Exposed=Window]
interface TransitionEvent : Event {
  constructor(DOMString type, optional TransitionEventInit transitionEventInitDict = {});
  readonly attribute DOMString propertyName;
  readonly attribute double elapsedTime;
  readonly attribute DOMString pseudoElement;
};

dictionary TransitionEventInit : EventInit {
  DOMString propertyName = "";
  double elapsedTime = 0.0;
  DOMString pseudoElement = "";
};
