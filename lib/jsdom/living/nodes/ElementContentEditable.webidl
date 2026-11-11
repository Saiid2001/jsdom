interface mixin ElementContentEditable {
//  [CEReactions] attribute DOMString contentEditable;
  [CEReactions, Reflect, ReflectEnum=("enter", "done", "go", "next", "previous", "search", "send")] attribute DOMString enterKeyHint;
//  readonly attribute boolean isContentEditable;
  [CEReactions, Reflect, ReflectEnum=("none", "text", "tel", "url", "email", "numeric", "decimal", "search")] attribute DOMString inputMode;
};
