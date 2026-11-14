// https://svgwg.org/svg2-draft/interact.html#InterfaceSVGScriptElement
[Exposed=Window]
interface SVGScriptElement : SVGElement {
  [CEReactions, Reflect] attribute DOMString type;
  [CEReactions, Reflect, ReflectEnum=("anonymous", "use-credentials"), ReflectEnumAlias=("", "anonymous"), ReflectInvalid="anonymous"] attribute DOMString? crossOrigin;
};
