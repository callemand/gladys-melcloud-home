// Widget refresh nudges, never lost.
//
// The core accepts one `requestWidgetRefresh` per widget every 10 s and drops
// the others silently. A nudge dropped that way can be the last one of a burst
// (MELCloud reporting a command back a few seconds after the previous refresh),
// and the widget would then keep showing the old state until something else
// happens. A nudge inside the window is postponed to its end instead.

// The core window, plus a margin for the time a nudge takes to reach it.
export const REFRESH_INTERVAL = 10500;

/**
 * Build a refresher that sends at most one nudge per interval, and always
 * sends one after the last request of a burst.
 * @param {object} options - Options.
 * @param {Function} options.request - Sends the nudge to the core.
 * @param {number} [options.interval] - Minimum time between two nudges, in ms.
 * @param {Function} [options.now] - Clock, injectable for the tests.
 * @param {Function} [options.setTimeoutImpl] - Timer, injectable for the tests.
 * @returns {{refresh: Function}} The refresher.
 */
export function createWidgetRefresher({
  request,
  interval = REFRESH_INTERVAL,
  now = () => Date.now(),
  setTimeoutImpl = setTimeout,
}) {
  let lastSent = -Infinity;
  let timer = null;

  function send() {
    timer = null;
    lastSent = now();
    request();
  }

  return {
    /**
     * Ask for a refresh: sent now, or at the end of the current window.
     * @returns {void} Nothing.
     */
    refresh() {
      if (timer) {
        return;
      }
      const wait = lastSent + interval - now();
      if (wait <= 0) {
        send();
        return;
      }
      timer = setTimeoutImpl(send, wait);
      // A pending nudge must not keep the process alive on shutdown.
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    },
  };
}
