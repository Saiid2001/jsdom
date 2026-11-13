[Exposed=Window,
 HTMLConstructor]
interface HTMLButtonElement : HTMLElement {
  [CEReactions, Reflect] attribute boolean autofocus;
  [CEReactions, Reflect] attribute boolean disabled;
  readonly attribute HTMLFormElement? form;
  [CEReactions] attribute USVString formAction;
  [CEReactions, Reflect, ReflectEnum=("application/x-www-form-urlencoded", "multipart/form-data", "text/plain"), ReflectInvalid="application/x-www-form-urlencoded"] attribute DOMString formEnctype;
  [CEReactions, Reflect, ReflectEnum=("get", "post", "dialog"), ReflectInvalid="get"] attribute DOMString formMethod;
  [CEReactions, Reflect] attribute boolean formNoValidate;
  [CEReactions, Reflect] attribute DOMString formTarget;
  [CEReactions, Reflect] attribute DOMString name;
  [CEReactions] attribute DOMString type;
  [CEReactions, Reflect] attribute DOMString value;

  readonly attribute boolean willValidate;
  readonly attribute ValidityState validity;
  readonly attribute DOMString validationMessage;
  boolean checkValidity();
  boolean reportValidity();
  undefined setCustomValidity(DOMString error);

  readonly attribute NodeList labels;
};
HTMLButtonElement includes PopoverInvokerElement;
