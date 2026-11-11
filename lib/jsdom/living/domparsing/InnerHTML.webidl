// https://w3c.github.io/DOM-Parsing/#the-innerhtml-mixin
interface mixin InnerHTML {
  [CEReactions] attribute [LegacyNullToEmptyString] DOMString innerHTML;

  // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#html-unsafe-methods
  // Declared once here for Element and ShadowRoot, which the spec gives the same two members. TrustedHTML is not
  // implemented, so the markup is a DOMString.
  [CEReactions] undefined setHTMLUnsafe(DOMString html);
  DOMString getHTML(optional GetHTMLOptions options = {});
};

dictionary GetHTMLOptions {
  boolean serializableShadowRoots = false;
  sequence<ShadowRoot> shadowRoots = [];
};

Element includes InnerHTML;
ShadowRoot includes InnerHTML;
