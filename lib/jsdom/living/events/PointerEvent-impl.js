"use strict";

const idlUtils = require("../generated/utils");
const MouseEventImpl = require("./MouseEvent-impl").implementation;

const PointerEventInit = require("../generated/PointerEventInit");

// https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle
function tiltToSpherical(tiltX, tiltY) {
  const tiltXrad = tiltX * Math.PI / 180;
  const tiltYrad = tiltY * Math.PI / 180;

  let azimuthAngle = 0;
  if (tiltX === 0) {
    if (tiltY > 0) {
      azimuthAngle = Math.PI / 2;
    } else if (tiltY < 0) {
      azimuthAngle = 3 * Math.PI / 2;
    }
  } else if (tiltY === 0) {
    if (tiltX < 0) {
      azimuthAngle = Math.PI;
    }
  } else if (Math.abs(tiltX) === 90 || Math.abs(tiltY) === 90) {
    azimuthAngle = 0;
  } else {
    azimuthAngle = Math.atan2(Math.tan(tiltYrad), Math.tan(tiltXrad));
    if (azimuthAngle < 0) {
      azimuthAngle += 2 * Math.PI;
    }
  }

  let altitudeAngle;
  if (Math.abs(tiltX) === 90 || Math.abs(tiltY) === 90) {
    altitudeAngle = 0;
  } else if (tiltX === 0) {
    altitudeAngle = Math.PI / 2 - Math.abs(tiltYrad);
  } else if (tiltY === 0) {
    altitudeAngle = Math.PI / 2 - Math.abs(tiltXrad);
  } else {
    altitudeAngle = Math.atan(1 / Math.sqrt(Math.tan(tiltXrad) ** 2 + Math.tan(tiltYrad) ** 2));
  }

  return { altitudeAngle, azimuthAngle };
}

// https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle
function sphericalToTilt(altitudeAngle, azimuthAngle) {
  const halfPi = Math.PI / 2;
  let tiltXrad = 0;
  let tiltYrad = 0;

  if (altitudeAngle === 0) {
    if (azimuthAngle === 0 || azimuthAngle === 2 * Math.PI) {
      tiltXrad = halfPi;
    } else if (azimuthAngle === halfPi) {
      tiltYrad = halfPi;
    } else if (azimuthAngle === Math.PI) {
      tiltXrad = -halfPi;
    } else if (azimuthAngle === 3 * halfPi) {
      tiltYrad = -halfPi;
    } else if (azimuthAngle > 0 && azimuthAngle < halfPi) {
      tiltXrad = halfPi;
      tiltYrad = halfPi;
    } else if (azimuthAngle > halfPi && azimuthAngle < Math.PI) {
      tiltXrad = -halfPi;
      tiltYrad = halfPi;
    } else if (azimuthAngle > Math.PI && azimuthAngle < 3 * halfPi) {
      tiltXrad = -halfPi;
      tiltYrad = -halfPi;
    } else if (azimuthAngle > 3 * halfPi && azimuthAngle < 2 * Math.PI) {
      tiltXrad = halfPi;
      tiltYrad = -halfPi;
    }
  } else {
    const tanAlt = Math.tan(altitudeAngle);
    tiltXrad = Math.atan(Math.cos(azimuthAngle) / tanAlt);
    tiltYrad = Math.atan(Math.sin(azimuthAngle) / tanAlt);
  }

  // tiltX and tiltY are longs.
  return { tiltX: Math.round(tiltXrad * 180 / Math.PI), tiltY: Math.round(tiltYrad * 180 / Math.PI) };
}

class PointerEventImpl extends MouseEventImpl {
  constructor(globalObject, args, privateData) {
    super(globalObject, args, privateData);

    // The four orientation members have no IDL default: whichever pair the initialiser leaves out is derived from
    // the pair it gives, and with neither the pointer is perpendicular to the screen.
    const init = args[1] || {};
    const hasTilt = init.tiltX !== undefined || init.tiltY !== undefined;
    const hasAngles = init.altitudeAngle !== undefined || init.azimuthAngle !== undefined;

    this.tiltX = init.tiltX ?? 0;
    this.tiltY = init.tiltY ?? 0;
    this.altitudeAngle = init.altitudeAngle ?? Math.PI / 2;
    this.azimuthAngle = init.azimuthAngle ?? 0;

    if (hasTilt && !hasAngles) {
      Object.assign(this, tiltToSpherical(this.tiltX, this.tiltY));
    } else if (hasAngles && !hasTilt) {
      Object.assign(this, sphericalToTilt(this.altitudeAngle, this.azimuthAngle));
    }

    this._coalescedEvents = init.coalescedEvents || [];
    this._predictedEvents = init.predictedEvents || [];
  }

  // An untrusted event reports the lists it was constructed with; a trusted one is never fired with coalesced or
  // predicted events, there being no pointer device behind the document.
  getCoalescedEvents() {
    return this._coalescedEvents.map(idlUtils.wrapperForImpl);
  }

  getPredictedEvents() {
    return this._predictedEvents.map(idlUtils.wrapperForImpl);
  }
}
PointerEventImpl.defaultInit = PointerEventInit.convert(undefined, undefined);

module.exports = {
  implementation: PointerEventImpl
};
