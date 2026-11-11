// https://dom.spec.whatwg.org/#documentorshadowroot
interface mixin DocumentOrShadowRoot {
};
Document includes DocumentOrShadowRoot;
ShadowRoot includes DocumentOrShadowRoot;

// https://html.spec.whatwg.org/multipage/dom.html#documentorshadowroot
partial interface mixin DocumentOrShadowRoot {
  readonly attribute Element? activeElement;
};

// https://drafts.csswg.org/cssom-view/#extensions-to-the-document-interface
// https://www.w3.org/TR/shadow-dom/#extensions-to-the-documentorshadowroot-mixin
// Declared on the mixin, as engines do, so that a shadow root answers too, retargeted against itself.
partial interface mixin DocumentOrShadowRoot {
  Element? elementFromPoint(double x, double y);
  sequence<Element> elementsFromPoint(double x, double y);
};
