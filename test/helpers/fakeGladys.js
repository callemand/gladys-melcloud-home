// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules and the registry rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishState / publishStates  -> record calls so tests can assert them
//   - publishDiscoveredDevices      -> record calls so tests can assert them
//   - setConnectionStatus           -> record calls so tests can assert them
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

/**
 * Build a fake SDK instance.
 * @param {object} [options] - Options.
 * @param {string} [options.selector] - Integration selector used in external ids.
 * @returns {object} The fake.
 */
export function createFakeGladys({ selector = 'test' } = {}) {
  const published = [];
  const discovered = [];
  const connectionStatuses = [];

  return {
    published,
    discovered,
    connectionStatuses,

    externalIds(type, platformId) {
      const device = `ext:${selector}:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const state of states) {
        published.push({
          featureExternalId: state.device_feature_external_id,
          state: state.state,
        });
      }
    },

    async publishDiscoveredDevices(devices) {
      discovered.push(devices);
      return { success: true, count: devices.length };
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
}
