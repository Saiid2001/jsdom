// https://html.spec.whatwg.org/#htmlareaelement
[Exposed=Window,
 HTMLConstructor]
interface HTMLAreaElement : HTMLElement {
  [CEReactions, Reflect] attribute DOMString alt;
  [CEReactions, Reflect] attribute DOMString coords;
  [CEReactions, Reflect] attribute DOMString shape;
  [CEReactions, Reflect] attribute DOMString target;
  [CEReactions, Reflect] attribute DOMString download;
  [CEReactions, Reflect] attribute USVString ping;
  [CEReactions, Reflect] attribute DOMString rel;
  [SameObject, PutForwards=value] readonly attribute DOMTokenList relList;
  [CEReactions, Reflect] attribute DOMString hreflang;
  [CEReactions, Reflect] attribute DOMString type;
  [CEReactions, Reflect, ReflectEnum=("", "no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin", "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url")] attribute DOMString referrerPolicy;

  // also has obsolete members
};
HTMLAreaElement includes HTMLHyperlinkElementUtils;

partial interface HTMLAreaElement {
  [CEReactions, Reflect] attribute boolean noHref;
};
