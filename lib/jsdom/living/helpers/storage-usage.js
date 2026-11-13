"use strict";

// What navigator.storage.estimate() reports (https://storage.spec.whatwg.org/#usage-and-quota).
//
// The quota is a constant. A browser derives it from the free space on the
// disk, which differs from one machine to the next and is read by pages as a
// fingerprint (and, below a threshold, as a private window), so it is not taken
// from the environment.
//
// The usage is that of the origin's storage shelf: the Web Storage this library
// holds (localStorage; sessionStorage is not on the shelf), plus whatever the
// host application reports for storage it keeps itself, such as IndexedDB.

// 128 GiB.
exports.STORAGE_QUOTA = 2 ** 37;

// A function of the serialized origin, answering a number of bytes or a promise
// of one. None installed is no storage beyond Web Storage.
let provideUsage = null;

exports.setStorageUsage = provider => {
  provideUsage = provider;
};

// Bytes as a browser stores them: two per UTF-16 code unit, key and value.
function webStorageUsage(storageArea) {
  let units = 0;

  for (const [key, value] of storageArea) {
    units += key.length + value.length;
  }

  return units * 2;
}

async function hostUsage(origin) {
  if (!provideUsage) {
    return 0;
  }

  try {
    const usage = Number(await provideUsage(origin));
    return Number.isFinite(usage) && usage > 0 ? Math.floor(usage) : 0;
  } catch {
    return 0;
  }
}

exports.estimateFor = async (window, origin) => {
  const area = window._currentOriginData && window._currentOriginData.localStorageArea;
  const usage = (area ? webStorageUsage(area) : 0) + await hostUsage(origin);

  return { usage, quota: exports.STORAGE_QUOTA };
};
