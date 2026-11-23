// Values commanded to the units, until MELCloud Home reports them.
//
// After a command, `/context` keeps reporting the previous value for a few
// seconds, and for tens of seconds when the unit is off. Every read published
// in that window (real-time refresh, poll, widget) would show the old value
// again. The store keeps the commanded value on top of those reads instead.

// How long a commanded value is shown at most, when MELCloud keeps reporting
// the value it had before the command.
export const PENDING_TTL = 90000;

/**
 * Remember the values commanded to the units until MELCloud reports them, so
 * a `/context` read that still has the previous value does not show it again
 * in Gladys (the tiles, the device card, the widget) in the meantime.
 * @param {object} [options] - Options.
 * @param {number} [options.ttl] - How long a commanded value wins at most, in ms.
 * @param {Function} [options.now] - Clock, injectable for the tests.
 * @returns {{set: Function, overlay: Function, apply: Function}} The store.
 */
export function createPendingStates({ ttl = PENDING_TTL, now = () => Date.now() } = {}) {
  const entries = new Map();

  /**
   * Apply the commanded values over the states read from MELCloud. A value
   * wins while MELCloud still reports the one it had when the command was
   * sent; it is forgotten once MELCloud reports anything else (the commanded
   * value, or a change made elsewhere, from the phone app), or once it expires.
   * Only the features present in `states` are touched.
   * @param {Map} states - Gladys value by feature external id (modified).
   * @returns {Map} The same map.
   */
  function overlay(states) {
    entries.forEach((entry, featureExternalId) => {
      if (entry.expiresAt <= now()) {
        entries.delete(featureExternalId);
      } else if (states.has(featureExternalId)) {
        if (states.get(featureExternalId) === entry.reported) {
          states.set(featureExternalId, entry.value);
        } else {
          entries.delete(featureExternalId);
        }
      }
    });
    return states;
  }

  return {
    /**
     * Record a commanded value.
     * @param {string} featureExternalId - The feature external id.
     * @param {number} value - The commanded Gladys value.
     * @param {number} [reported] - The value MELCloud reported when the command was sent.
     * @returns {void} Nothing.
     */
    set(featureExternalId, value, reported) {
      entries.set(featureExternalId, { value, reported, expiresAt: now() + ttl });
    },

    overlay,

    /**
     * Apply the commanded values over a list of states read from MELCloud.
     * @param {Array<{device_feature_external_id: string, state: number}>} states - The states.
     * @returns {Array} New states, with the commanded values where they still win.
     */
    apply(states) {
      const values = overlay(
        new Map(states.map((state) => [state.device_feature_external_id, state.state])),
      );
      return states.map((state) => ({
        ...state,
        state: values.get(state.device_feature_external_id),
      }));
    },
  };
}
