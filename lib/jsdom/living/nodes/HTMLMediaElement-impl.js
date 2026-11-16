"use strict";
const DOMException = require("../generated/DOMException");
const HTMLElementImpl = require("./HTMLElement-impl").implementation;
const notImplemented = require("../../browser/not-implemented");
const { fireAnEvent } = require("../helpers/events");

function getTimeRangeDummy() {
  return {
    length: 0,
    start() {
      return 0;
    },
    end() {
      return 0;
    }
  };
}

class HTMLMediaElementImpl extends HTMLElementImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    this._muted = false;
    this._volume = 1.0;
    this.readyState = 0;
    this.networkState = 0;
    this.currentTime = 0;
    this.currentSrc = "";
    this.buffered = getTimeRangeDummy();
    this.seeking = false;
    this.duration = NaN;
    this.paused = true;
    this.played = getTimeRangeDummy();
    this.seekable = getTimeRangeDummy();
    this.ended = false;
    this.audioTracks = [];
    this.videoTracks = [];
    this.textTracks = [];
  }

  get defaultPlaybackRate() {
    if (this._defaultPlaybackRate === undefined) {
      return 1.0;
    }
    return this._defaultPlaybackRate;
  }

  set defaultPlaybackRate(v) {
    if (v === 0.0) {
      throw DOMException.create(this._globalObject, ["The operation is not supported.", "NotSupportedError"]);
    }
    if (this._defaultPlaybackRate !== v) {
      this._defaultPlaybackRate = v;
      this._dispatchRateChange();
    }
  }

  get playbackRate() {
    if (this._playbackRate === undefined) {
      return 1.0;
    }
    return this._playbackRate;
  }

  set playbackRate(v) {
    if (v !== this._playbackRate) {
      this._playbackRate = v;
      this._dispatchRateChange();
    }
  }

  get muted() {
    return this._muted;
  }

  set muted(v) {
    if (v !== this._muted) {
      this._muted = v;
      this._dispatchVolumeChange();
    }
  }

  get defaultMuted() {
    return this.getAttributeNS(null, "muted") !== null;
  }

  set defaultMuted(v) {
    if (v) {
      this.setAttributeNS(null, "muted", v);
    } else {
      this.removeAttributeNS(null, "muted");
    }
  }

  get volume() {
    return this._volume;
  }

  set volume(v) {
    if (v < 0 || v > 1) {
      throw DOMException.create(this._globalObject, ["The index is not in the allowed range.", "IndexSizeError"]);
    }
    if (this._volume !== v) {
      this._volume = v;
      this._dispatchVolumeChange();
    }
  }

  // Not (yet) implemented according to spec
  // Should return sane default values
  load() {
    notImplemented("HTMLMediaElement.prototype.load", this._ownerDocument._defaultView);
  }
  canPlayType() {
    return "";
  }
  // Nothing is ever played, and canPlayType says so for every type: play() rejects as it
  // does for an element with no source the browser can play. Thrown, the wrapper hands
  // it to the page as a rejected promise of its own realm. Answering nothing at all made
  // `video.play().catch(...)` -- the commonest line a page writes about video -- throw.
  // https://html.spec.whatwg.org/multipage/media.html#dom-media-play
  play() {
    throw DOMException.create(this._globalObject, [
      "The element has no supported sources.",
      "NotSupportedError"
    ]);
  }

  // Already paused, since nothing plays: the steps change nothing and fire nothing.
  // https://html.spec.whatwg.org/multipage/media.html#dom-media-pause
  pause() {
    this.paused = true;
  }
  addTextTrack() {
    notImplemented("HTMLMediaElement.prototype.addTextTrack", this._ownerDocument._defaultView);
  }

  _dispatchRateChange() {
    fireAnEvent("ratechange", this);
  }

  _dispatchVolumeChange() {
    fireAnEvent("volumechange", this);
  }
}

module.exports = {
  implementation: HTMLMediaElementImpl
};
