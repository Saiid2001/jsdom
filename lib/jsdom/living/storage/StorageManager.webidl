// https://storage.spec.whatwg.org/#api
// [SecureContext] is applied when a window is made (browser/Window.js):
// webidl2js does not act on it.
[SecureContext,
 Exposed=(Window,Worker)]
interface StorageManager {
  Promise<boolean> persisted();
  [Exposed=Window] Promise<boolean> persist();

  Promise<StorageEstimate> estimate();
};

dictionary StorageEstimate {
  unsigned long long usage;
  unsigned long long quota;
};
