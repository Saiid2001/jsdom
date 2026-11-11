[Exposed=Window,
 HTMLConstructor]
interface HTMLMetaElement : HTMLElement {
  [CEReactions, Reflect] attribute DOMString name;
  [CEReactions, Reflect="http-equiv"] attribute DOMString httpEquiv;
  [CEReactions, Reflect] attribute DOMString content;
  [CEReactions, Reflect] attribute DOMString media;

  // also has obsolete members
};

partial interface HTMLMetaElement {
  [CEReactions, Reflect] attribute DOMString scheme;
};
