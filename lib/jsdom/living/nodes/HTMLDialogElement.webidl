// https://html.spec.whatwg.org/multipage/interactive-elements.html#htmldialogelement
[Exposed=Window,
 HTMLConstructor]
interface HTMLDialogElement : HTMLElement {
  [CEReactions, Reflect] attribute boolean open;
  attribute DOMString returnValue;
  [CEReactions] undefined show();
  [CEReactions] undefined showModal();
  [CEReactions] undefined close(optional DOMString returnValue);
  [CEReactions] undefined requestClose(optional DOMString returnValue);
};
