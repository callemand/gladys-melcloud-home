// Cache over the unit listings: one `GET /context` returns a whole family, but
// Gladys polls device by device, firing one `onPoll` per device in the same
// tick. Concurrent callers share the in-flight promise, and the TTL covers
// back-to-back ticks.

// Well under the one-minute poll cycle, so a poll is never served the previous
// cycle's state.
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
      // Never cache a failure; the rejection still reaches the caller.
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
