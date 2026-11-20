// Requests that land while the integration starts.
//
// Gladys marks the integration running, and sends it requests, as soon as its
// socket authenticates: a dashboard pulls its widgets right then. The SDK
// still reads the devices and the configuration before it emits `connected`,
// and the MELCloud Home client is built after that, so such a request would
// find no client and answer "not configured", an answer the core then caches.
// A request waits for the initialization instead, within a bound kept under
// the core's 15 s command timeout: a timed-out widget stays on an error until
// the page is reloaded.

export const INIT_WAIT = 10000;

/**
 * Build the gate between the initializations and the requests.
 * @param {object} [options] - Options.
 * @param {number} [options.timeout] - Longest wait, in ms.
 * @param {Function} [options.setTimeoutImpl] - Timer, injectable for the tests.
 * @param {Function} [options.clearTimeoutImpl] - Timer cleanup, injectable for the tests.
 * @returns {{run: Function, wait: Function}} The gate.
 */
export function createInitGate({
  timeout = INIT_WAIT,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  let started = false;
  let running = 0;
  let waiters = [];

  const isSettled = () => started && running === 0;

  function releaseWaiters() {
    if (!isSettled()) {
      return;
    }
    const released = waiters;
    waiters = [];
    released.forEach((release) => release(true));
  }

  return {
    /**
     * Run an initialization: requests wait until it is over.
     * @param {Function} task - The initialization.
     * @returns {Promise<any>} The initialization's result.
     */
    run(task) {
      started = true;
      running += 1;
      return Promise.resolve()
        .then(task)
        .finally(() => {
          running -= 1;
          releaseWaiters();
        });
    },

    /**
     * Wait until an initialization has run and none is in progress.
     * @returns {Promise<boolean>} True when settled, false when the wait timed out.
     */
    wait() {
      if (isSettled()) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const release = (settled) => {
          clearTimeoutImpl(timer);
          resolve(settled);
        };
        const timer = setTimeoutImpl(() => {
          waiters = waiters.filter((waiter) => waiter !== release);
          resolve(false);
        }, timeout);
        // A pending wait must not keep the process alive on shutdown.
        if (timer && typeof timer.unref === 'function') {
          timer.unref();
        }
        waiters.push(release);
      });
    },
  };
}
