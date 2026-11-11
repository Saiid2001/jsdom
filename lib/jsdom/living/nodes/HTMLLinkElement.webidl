// https://html.spec.whatwg.org/#htmllinkelement
[Exposed=Window,
 HTMLConstructor]
interface HTMLLinkElement : HTMLElement {
  [CEReactions, ReflectURL] attribute USVString href;
  [CEReactions, Reflect, ReflectEnum=("anonymous", "use-credentials"), ReflectEnumAlias=("", "anonymous"), ReflectInvalid="anonymous"] attribute DOMString? crossOrigin;
  [CEReactions, Reflect] attribute DOMString rel;
  [CEReactions, Reflect, ReflectEnum=("fetch", "audio", "document", "embed", "font", "image", "manifest", "object", "report", "script", "sharedworker", "style", "track", "video", "worker", "xslt")] attribute DOMString as;
  [SameObject, PutForwards=value] readonly attribute DOMTokenList relList;
  [CEReactions, Reflect] attribute DOMString media;
  [CEReactions, Reflect] attribute DOMString integrity;
  [CEReactions, Reflect] attribute DOMString hreflang;
  [CEReactions, Reflect] attribute DOMString type;
//  [SameObject, PutForwards=value] readonly attribute DOMTokenList sizes;
//  [CEReactions] attribute USVString imageSrcset;
//  [CEReactions] attribute DOMString imageSizes;
  [CEReactions, Reflect, ReflectEnum=("", "no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin", "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url")] attribute DOMString referrerPolicy;

  // also has obsolete members
};
HTMLLinkElement includes LinkStyle;

// https://html.spec.whatwg.org/#HTMLLinkElement-partial
partial interface HTMLLinkElement {
  [CEReactions, Reflect] attribute DOMString charset;
  [CEReactions, Reflect] attribute DOMString rev;
  [CEReactions, Reflect] attribute DOMString target;
};
