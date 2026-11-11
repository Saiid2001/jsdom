// https://drafts.csswg.org/css-animations/#interface-animationevent
[Exposed=Window]
interface AnimationEvent : Event {
  constructor(DOMString type, optional AnimationEventInit animationEventInitDict = {});
  readonly attribute DOMString animationName;
  readonly attribute double elapsedTime;
  readonly attribute DOMString pseudoElement;
};

dictionary AnimationEventInit : EventInit {
  DOMString animationName = "";
  double elapsedTime = 0.0;
  DOMString pseudoElement = "";
};
