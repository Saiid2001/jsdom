"use strict";

// Where the time this library spends goes, by what spends it.
//
// A host application that wants to know how much of a page load is the page's script, how
// much its parsing, installs a clock here; the points that hand control to a page's code or
// to the parser report entering and leaving it. With none installed each report is one
// comparison, and nothing is recorded.
//
// enter() returns a token, exit() takes it back: the clock charges time exclusively, so a
// script a parser chunk runs is the script's time and not the parser's. It is told the global
// object the work is for, so work for one window can be told from another's.

let clock = null;

exports.setModuleClock = value => {
  clock = value;
};

exports.enter = (module, globalObject) => (clock ? clock.enter(module, globalObject) : -1);

exports.exit = token => {
  if (token !== -1 && clock) {
    clock.exit(token);
  }
};

// A request of `globalObject`'s, sent and settled: the clock counts the wall time any is open.
exports.requestStarted = globalObject => {
  if (clock) {
    clock.requestStarted(globalObject);
  }
};

exports.requestEnded = globalObject => {
  if (clock) {
    clock.requestEnded(globalObject);
  }
};
