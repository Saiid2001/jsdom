[Exposed=Window,
 HTMLConstructor]
interface HTMLTemplateElement : HTMLElement {
  readonly attribute DocumentFragment content;
  [CEReactions] attribute DOMString shadowRootMode;
  [CEReactions, Reflect] attribute boolean shadowRootDelegatesFocus;
  [CEReactions, Reflect] attribute boolean shadowRootClonable;
  [CEReactions, Reflect] attribute boolean shadowRootSerializable;
  [CEReactions] attribute DOMString shadowRootSlotAssignment;
};
