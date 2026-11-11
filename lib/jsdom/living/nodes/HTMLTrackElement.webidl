[Exposed=Window,
 HTMLConstructor]
interface HTMLTrackElement : HTMLElement {
  [CEReactions, Reflect, ReflectEnum=("subtitles", "captions", "descriptions", "chapters", "metadata"), ReflectMissing="subtitles", ReflectInvalid="metadata"] attribute DOMString kind;
  [CEReactions, ReflectURL] attribute USVString src;
  [CEReactions, Reflect] attribute DOMString srclang;
  [CEReactions, Reflect] attribute DOMString label;
  [CEReactions, Reflect] attribute boolean default;

  const unsigned short NONE = 0;
  const unsigned short LOADING = 1;
  const unsigned short LOADED = 2;
  const unsigned short ERROR = 3;
  readonly attribute unsigned short readyState;

//  readonly attribute TextTrack track;
};
