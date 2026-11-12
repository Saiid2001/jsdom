"use strict";

class QueueItem {
  constructor(request, onLoad, onError, dependentItem) {
    this.request = request;
    this.onLoad = onLoad;
    this.onError = onError;
    this.data = null;
    this.error = null;
    this.dependentItem = dependentItem;
  }
}

/**
 * AsyncResourceQueue is the queue in charge of run the async scripts
 * and notify when they finish.
 */
module.exports = class AsyncResourceQueue {
  constructor() {
    this.items = new Set();
    this.dependentItems = new Set();
  }

  count() {
    return this.items.size + this.dependentItems.size;
  }

  _notify() {
    if (this._listener) {
      this._listener();
    }
  }

  _check(item) {
    let promise;

    if (item.onError && item.error) {
      promise = item.onError(item.error);
    } else if (item.onLoad && item.data) {
      promise = item.onLoad(item.data);
    }

    Promise.resolve(promise)
      .then(() => {
        item.finished = true;
        this.items.delete(item);
        this.dependentItems.delete(item);
        this.notifyItem(item);

        if (this.count() === 0) {
          this._notify();
        }
      });
  }

  setListener(listener) {
    this._listener = listener;
  }

  // Runs each as soon as it and every one pushed this way before it have run: in order, holding nothing else up.
  pushInOrder(request, onLoad, onError) {
    const previous = this._inOrderTail && !this._inOrderTail.finished ? this._inOrderTail : null;
    const pushed = this.push(request, onLoad, onError, previous);
    this._inOrderTail = this._lastItem;
    return pushed;
  }

  push(request, onLoad, onError, dependentItem) {
    const q = this;

    const item = new QueueItem(request, onLoad, onError, dependentItem);

    q.items.add(item);
    q._lastItem = item;

    return request
      .then(data => {
        item.data = data;

        if (dependentItem && !dependentItem.finished) {
          q.dependentItems.add(item);
          return q.items.delete(item);
        }

        if (onLoad) {
          return q._check(item);
        }

        q.items.delete(item);

        if (q.count() === 0) {
          q._notify();
        }

        return null;
      })
      .catch(err => {
        item.error = err;

        if (dependentItem && !dependentItem.finished) {
          q.dependentItems.add(item);
          return q.items.delete(item);
        }

        if (onError) {
          return q._check(item);
        }

        q.items.delete(item);

        if (q.count() === 0) {
          q._notify();
        }

        return null;
      });
  }

  // A request no longer waited on. It still settles, and its callbacks still
  // run when it does, but it stops counting.
  forget(request) {
    for (const set of [this.items, this.dependentItems]) {
      for (const item of set) {
        if (item.request === request) {
          set.delete(item);
        }
      }
    }

    if (this.count() === 0) {
      this._notify();
    }
  }

  notifyItem(syncItem) {
    for (const item of this.dependentItems) {
      if (item.dependentItem === syncItem) {
        this._check(item);
      }
    }
  }
};
