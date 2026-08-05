// -----------------------------------------------------------------------------
// Short-lived cache over the MELCloud Home unit listings.
//
// Every unit of a family comes from ONE `GET /context` call, but Gladys polls
// device by device: with four air conditioners on the same poll frequency, the
// scheduler fires four `onPoll` in the same tick and the naive implementation
// re-fetched the whole account four times a minute (and once more per command).
//
// Two mechanisms, both needed:
//   - in-flight sharing: concurrent callers await the SAME promise, so a burst
//     of polls collapses into a single request;
//   - a short TTL: back-to-back ticks reuse the response instead of re-fetching.
//
// The TTL is deliberately much shorter than the poll frequency (one minute), so
// a poll never serves a state from the previous tick. Commands invalidate the
// cache explicitly, so the poll that follows a command reads the real state.
// -----------------------------------------------------------------------------

// Long enough to collapse a burst of simultaneous polls, short enough that no
// poll cycle (60 s) is ever served from the previous one.
export const DEFAULT_TTL = 10000;

/**
 * Build a cache of unit listings, keyed by device family.
 * @param {object} [options] - Options.
 * @param {number} [options.ttl] - Freshness window in milliseconds.
 * @param {Function} [options.now] - Clock, injectable for the tests.
 * @returns {{get: Function, invalidate: Function}} The cache.
 */
export function createUnitCache({ ttl = DEFAULT_TTL, now = () => Date.now() } = {}) {
  const entries = new Map();

  return {
    /**
     * Return the cached listing for `key`, or load it.
     * @param {string} key - Cache key (a device family key).
     * @param {Function} loader - Called on a miss, returns a promise of units.
     * @returns {Promise<Array>} The units.
     */
    get(key, loader) {
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now()) {
        return cached.promise;
      }
      const promise = Promise.resolve().then(loader);
      const entry = { expiresAt: now() + ttl, promise };
      entries.set(key, entry);
      // A failed load must not be cached: drop it so the next caller retries.
      // The rejection still reaches the caller through the returned promise.
      promise.catch(() => {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }
      });
      return promise;
    },

    /**
     * Forget a cached listing, or all of them.
     * @param {string} [key] - The family key; every family when omitted.
     * @returns {void} Nothing.
     */
    invalidate(key) {
      if (key === undefined) {
        entries.clear();
      } else {
        entries.delete(key);
      }
    },
  };
}
