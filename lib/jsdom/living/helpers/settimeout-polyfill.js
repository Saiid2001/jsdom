// Timers that are not subject to the browser's nested-timeout clamping.
//
// A page that schedules a timeout from inside a timeout is clamped to 4ms once
// it is five deep, and a script that drives itself that way — a stepped
// animation, a parser yielding between chunks — then runs at a quarter of the
// speed it asked for. A delay short enough for that to matter is stepped
// through a message instead, which is not clamped.
//
// Resolved off globalThis rather than a bare `window`: there is no window in a
// worker, and the minimal shim that stands in for one where a library insists
// on it carries neither `performance` nor `postMessage`, so this threw before
// it could schedule anything at all.
//
// The channel is this module's own, so nothing has to be namespaced against
// whatever else the surrounding page or worker sends itself.

const scope = globalThis;

// Captured now, before a document's own timers are installed over them: these
// are the environment's, and are what a long wait is actually handed to.
const hostSetTimeout = scope.setTimeout.bind(scope);
const hostClearTimeout = scope.clearTimeout.bind(scope);

// Below this a delay is stepped through the channel, above it the host's own
// timer is accurate enough and does not spin. 4ms is where clamping begins.
const CLAMP_FLOOR = 4;

function now() {
  return scope.performance && typeof scope.performance.now === "function"
    ? scope.performance.now()
    : Date.now();
}

let nextId = 1;

// timeout id -> { tick, host } — dropped when the timer fires or is cleared,
// so neither the entry nor anything it holds outlives the timer.
const timeouts = new Map();
// interval id -> id of the timeout currently scheduling its next tick
const intervals = new Map();

const channel = typeof scope.MessageChannel === "function" ? new scope.MessageChannel() : null;

if (channel) {
  channel.port1.onmessage = event => {
    const timer = timeouts.get(event.data);

    if (timer) {
      timer.tick();
    }
  };

  // A port delivered to via onmessage is started implicitly, but not every
  // implementation agrees, and starting one twice is harmless.
  if (typeof channel.port1.start === "function") {
    channel.port1.start();
  }
}

function step(id, remaining) {
  const timer = timeouts.get(id);

  if (!timer) {
    return;
  }

  if (channel && remaining < CLAMP_FLOOR) {
    channel.port2.postMessage(id);
    return;
  }

  timer.host = hostSetTimeout(() => {
    const live = timeouts.get(id);

    if (live) {
      live.tick();
    }
  }, Math.max(0, remaining));
}

function cancelTimeout(id) {
  const timer = timeouts.get(id);

  if (!timer) {
    return;
  }

  if (timer.host !== undefined) {
    hostClearTimeout(timer.host);
  }

  timeouts.delete(id);
}

function customSetTimeout(cb, interval, ...args) {
  const started = now();
  const delay = interval || 0;
  const id = nextId++;

  const tick = () => {
    if (!timeouts.has(id)) {
      return;
    }

    const elapsed = now() - started;

    if (elapsed >= delay) {
      cancelTimeout(id);
      cb(...args);
      return;
    }

    step(id, delay - elapsed);
  };

  timeouts.set(id, { tick, host: undefined });
  step(id, delay);

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
