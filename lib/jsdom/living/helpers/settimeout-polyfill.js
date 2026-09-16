// Timers backed by postMessage rather than the host's setTimeout, so scheduling
// is not subject to the browser's nested-timeout clamping.
//
// Bookkeeping is keyed by id in a Map and dropped when a timer fires or is
// cleared: neither the message listener nor the entry may outlive the timer.
// Message data is namespaced because the host page uses postMessage too.

const PREFIX = "jsdom-timer:";

let nextId = 1;

// timeout id -> { handleMessage }
const timeouts = new Map();
// interval id -> id of the timeout currently scheduling its next tick
const intervals = new Map();

function cancelTimeout(id) {
  const timer = timeouts.get(id);

  if (!timer) {
    return;
  }

  window.removeEventListener("message", timer.handleMessage);
  timeouts.delete(id);
}

function customSetTimeout(cb, interval, ...args) {
  const now = window.performance.now();
  const delay = interval || 0;
  const id = nextId++;
  const message = PREFIX + id;

  const handleMessage = evt => {
    if (evt.data !== message || !timeouts.has(id)) {
      return;
    }

    if (window.performance.now() - now >= delay) {
      cancelTimeout(id);
      cb(...args);
    } else {
      window.postMessage(message, "*");
    }
  };

  timeouts.set(id, { handleMessage });
  window.addEventListener("message", handleMessage);
  window.postMessage(message, "*");

  return id;
}

function customClearTimeout(setTimeoutId) {
  cancelTimeout(setTimeoutId);
}

function customSetInterval(cb, interval, ...args) {
  const intervalId = nextId++;

  const tick = () => {
    if (!intervals.has(intervalId)) {
      return;
    }

    cb(...args);

    // The callback may have cleared this interval.
    if (intervals.has(intervalId)) {
      intervals.set(intervalId, customSetTimeout(tick, interval));
    }
  };

  intervals.set(intervalId, customSetTimeout(tick, interval));

  return intervalId;
}

function customClearInterval(intervalId) {
  const pending = intervals.get(intervalId);

  if (pending !== undefined) {
    cancelTimeout(pending);
  }

  intervals.delete(intervalId);
}

module.exports = {
  setTimeout: customSetTimeout,
  clearTimeout: customClearTimeout,
  setInterval: customSetInterval,
  clearInterval: customClearInterval
};
