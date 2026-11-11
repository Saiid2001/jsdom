interface mixin HTMLOrSVGElement {
  [SameObject] readonly attribute DOMStringMap dataset;
  attribute DOMString nonce; // intentionally no [CEReactions]

  // Reflected only: nothing focuses an autofocus element.
  [CEReactions, Reflect] attribute boolean autofocus;

  [CEReactions] attribute long tabIndex;
//  We don't support FocusOptions yet
//  undefined focus(optional FocusOptions options = {});
  undefined focus();
  undefined blur();
};
