// https://gist.github.com/ahmadalibaloch/6c7d70244c83b90aa77bb83fa28cd0df
// TODO

const setTimeouts = [];
function customSetTimeout(cb, interval) {
  const now = window.performance.now();
  const index = setTimeouts.length;
  setTimeouts[index] = () => {
    cb();
  };
  setTimeouts[index].active = true;
  const handleMessage = (evt) => {
    if (evt.data === index) {
      if (window.performance.now() - now >= interval) {
        window.removeEventListener('message', handleMessage);
        if (setTimeouts[index].active) {
          setTimeouts[index]();
        }
      } else {
        window.postMessage(index, '*');
      }
    }
  };
  window.addEventListener('message', handleMessage);
  window.postMessage(index, '*');
  return index;
}

function customClearTimeout(setTimeoutId) {
  if (setTimeouts[setTimeoutId]) {
    setTimeouts[setTimeoutId].active = false;
  }
}

setIntervals = [];
function customSetInterval(cb, interval) {
  const intervalId = setIntervals.length;
  setIntervals[intervalId] = function () {
    if (setIntervals[intervalId].active) {
      cb();
      customSetTimeout(setIntervals[intervalId], interval);
    }
  };
  setIntervals[intervalId].active = true;
  customSetTimeout(setIntervals[intervalId], interval);
  return intervalId;
}

function customClearInterval(intervalId) {
  if (setIntervals[intervalId]) {
    setIntervals[intervalId].active = false;
  }
}

module.exports = {  
    setTimeout: customSetTimeout,
    clearTimeout: customClearTimeout,
    setInterval: customSetInterval,
    clearInterval: customClearInterval
};