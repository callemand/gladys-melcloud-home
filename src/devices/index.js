// -----------------------------------------------------------------------------
// Device registry.
//
// Add or remove device families here. Each family lives in its own file and
// exposes the same shape:
//   - buildDevice(gladys, unit)                  : the discovery payload
//   - readStates(gladys, unit)                   : the states to publish
//   - buildSetPayload(gladys, unit, id, value)   : the command body, or null
//     when the feature is read-only
//   - findUnitByExternalId(gladys, units, id)    : dispatch a Gladys device back
//     to the MELCloud Home unit it was built from
//
// A blueprint pairs such a module with the two API calls that list and command
// that family. `createDeviceRegistry` turns the set of blueprints into the
// routing the entry point needs, and owns the cache in front of the listings.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';

import * as airToAir from './airToAir.js';
import * as airToWater from './airToWater.js';
import { createUnitCache } from './unitCache.js';

export const DEVICE_BLUEPRINTS = [
  {
    key: 'ata',
    label: 'air conditioner',
    module: airToAir,
    listUnits: (api) => api.listAtaUnits(),
    setUnit: (api, unitId, payload) => api.setAtaUnit(unitId, payload),
  },
  {
    key: 'atw',
    label: 'heat pump',
    module: airToWater,
    listUnits: (api) => api.listAtwUnits(),
    setUnit: (api, unitId, payload) => api.setAtwUnit(unitId, payload),
  },
];

/**
 * Build the routing over a set of device blueprints.
 * @param {object} options - Options.
 * @param {object} options.gladys - The SDK instance (builds the external ids).
 * @param {Array} [options.blueprints] - The device families to serve.
 * @param {object} [options.cache] - The unit listing cache.
 * @returns {object} The registry.
 */
export function createDeviceRegistry({
  gladys,
  blueprints = DEVICE_BLUEPRINTS,
  cache = createUnitCache(),
} = {}) {
  const listUnits = (api, blueprint) => cache.get(blueprint.key, () => blueprint.listUnits(api));

  /**
   * Find the blueprint and the unit a Gladys device was built from.
   * @param {object} api - The MELCloud Home client.
   * @param {object} device - The Gladys device (has external_id).
   * @returns {Promise<{blueprint: object, unit: object}|null>} Match or null.
   */
  async function findBlueprintByDevice(api, device) {
    for (const blueprint of blueprints) {
      const units = await listUnits(api, blueprint);
      const unit = blueprint.module.findUnitByExternalId(gladys, units, device.external_id);
      if (unit) {
        return { blueprint, unit };
      }
    }
    return null;
  }

  return {
    blueprints,

    /**
     * Drop the cached listings, so the next read hits MELCloud Home.
     * @returns {void} Nothing.
     */
    invalidate() {
      cache.invalidate();
    },

    /**
     * Build the discovery payload: every unit of every family.
     * @param {object} api - The MELCloud Home client.
     * @returns {Promise<Array>} The Gladys devices.
     */
    async buildDiscoveredDevices(api) {
      const devices = [];
      for (const blueprint of blueprints) {
        const units = await listUnits(api, blueprint);
        logger.info(`Discovered ${units.length} MELCloud Home ${blueprint.label}(s)`);
        units.forEach((unit) => devices.push(blueprint.module.buildDevice(gladys, unit)));
      }
      return devices;
    },

    /**
     * Read the current states of one device.
     * @param {object} api - The MELCloud Home client.
     * @param {object} device - The Gladys device.
     * @returns {Promise<Array|null>} The states, or null when unknown.
     */
    async readStates(api, device) {
      const match = await findBlueprintByDevice(api, device);
      if (!match) {
        return null;
      }
      return match.blueprint.module.readStates(gladys, match.unit);
    },

    /**
     * Send a feature change to MELCloud Home.
     * @param {object} api - The MELCloud Home client.
     * @param {object} device - The Gladys device.
     * @param {object} feature - The changed feature.
     * @param {number} value - The Gladys value.
     * @returns {Promise<void>} Nothing.
     */
    async setValue(api, device, feature, value) {
      const match = await findBlueprintByDevice(api, device);
      if (!match) {
        throw new Error(`MELCloud Home unit not found for ${device.external_id}`);
      }
      const payload = match.blueprint.module.buildSetPayload(
        gladys,
        match.unit,
        feature.external_id,
        value,
      );
      if (!payload) {
        throw new Error(`MELCloud Home feature is not writable: ${feature.external_id}`);
      }
      await match.blueprint.setUnit(api, match.unit.id, payload);
      // The cached listing still holds the pre-command state: drop it so the
      // next poll reads what the unit actually did with the command.
      cache.invalidate();
    },
  };
}
