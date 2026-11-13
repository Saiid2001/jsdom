// https://wicg.github.io/ua-client-hints/#interface
dictionary NavigatorUABrandVersion {
  DOMString brand;
  DOMString version;
};

dictionary UADataValues {
  DOMString architecture;
  DOMString bitness;
  sequence<NavigatorUABrandVersion> brands;
  sequence<DOMString> formFactors;
  sequence<NavigatorUABrandVersion> fullVersionList;
  DOMString model;
  boolean mobile;
  DOMString platform;
  DOMString platformVersion;
  DOMString uaFullVersion;
  boolean wow64;
};

dictionary UALowEntropyJSON {
  sequence<NavigatorUABrandVersion> brands;
  boolean mobile;
  DOMString platform;
};

[Exposed=(Window,Worker)]
interface NavigatorUAData {
  readonly attribute FrozenArray<NavigatorUABrandVersion> brands;
  readonly attribute boolean mobile;
  readonly attribute DOMString platform;
  Promise<UADataValues> getHighEntropyValues(sequence<DOMString> hints);
  UALowEntropyJSON toJSON();
};
