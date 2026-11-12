// https://html.spec.whatwg.org/multipage/popover.html#popoverinvokerelement
interface mixin PopoverInvokerElement {
  [CEReactions] attribute Element? popoverTargetElement;
  [CEReactions, Reflect, ReflectEnum=("toggle", "show", "hide"), ReflectMissing="toggle", ReflectInvalid="toggle"] attribute DOMString popoverTargetAction;
};
