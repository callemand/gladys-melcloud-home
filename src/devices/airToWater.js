// AIR-TO-WATER unit (Ecodan heat pump: domestic hot water + heating).
//
// Like air-to-air, state is a `settings: [{name, value}]` array of STRINGS.
// Commands go to `PUT /monitor/atwunit/{id}` with EVERY control field present:
// the changed one carries its value, the rest are `null` (the BFF rejects a
// sparse patch).
//
// Zone operation MODE is deferred: the sources disagree on whether the PUT
// takes PascalCase or camelCase, and it needs a real device to settle.

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import { POLL_FREQUENCY } from '../config.js';

export const DEVICE_TYPE = 'atw';

export const FEATURE = {
  POWER: 'power',
  FORCED_HOT_WATER: 'forced-hot-water',
  TANK_TEMPERATURE: 'tank-temperature',
  TANK_SET_TEMPERATURE: 'tank-set-temperature',
  ZONE1_ROOM_TEMPERATURE: 'zone1-room-temperature',
  ZONE1_SET_TEMPERATURE: 'zone1-set-temperature',
  OUTDOOR_TEMPERATURE: 'outdoor-temperature',
};

// Default bounds. Per the reverse-engineering notes, the API-reported zone
// ranges are unreliable, so zone bounds are hardcoded; the tank bounds are read
// from `capabilities` when present and fall back to these.
const ZONE_MIN_TEMPERATURE = 10;
const ZONE_MAX_TEMPERATURE = 30;
const TANK_MIN_TEMPERATURE = 40;
const TANK_MAX_TEMPERATURE = 60;

// The BFF PUT body must carry every control field; only the changed one holds a
// value, the rest are null.
const CONTROL_FIELDS = [
  'power',
  'setTankWaterTemperature',
  'forcedHotWaterMode',
  'setTemperatureZone1',
  'setTemperatureZone2',
  'operationModeZone1',
  'operationModeZone2',
  'inStandbyMode',
  'setHeatFlowTemperatureZone1',
  'setCoolFlowTemperatureZone1',
  'setHeatFlowTemperatureZone2',
  'setCoolFlowTemperatureZone2',
];

/**
 * Read a value from the unit `settings` array.
 * @param {object} unit - Air-to-water unit.
 * @param {string} name - Setting name.
 * @returns {string|undefined} The setting value.
 */
export function getSetting(unit, name) {
  const setting = (unit.settings || []).find((currentSetting) => currentSetting.name === name);
  return setting ? setting.value : undefined;
}

function toBoolean(value) {
  return value === 'True' || value === 'true' || value === '1';
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getTankBounds(unit) {
  const capabilities = unit.capabilities || {};
  const min =
    typeof capabilities.minSetTankTemperature === 'number'
      ? capabilities.minSetTankTemperature
      : TANK_MIN_TEMPERATURE;
  const max =
    typeof capabilities.maxSetTankTemperature === 'number'
      ? capabilities.maxSetTankTemperature
      : TANK_MAX_TEMPERATURE;
  return { min, max };
}

/**
 * Build the Gladys discovery payload for one air-to-water unit.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-water unit.
 * @returns {object} The Gladys device.
 */
export function buildDevice(gladys, unit) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const capabilities = unit.capabilities || {};
  const tank = getTankBounds(unit);
  const hasHotWater = capabilities.hasHotWater !== false;

  const features = [
    {
      name: 'Power',
      external_id: ids.feature(FEATURE.POWER),
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    {
      name: 'Zone 1 temperature',
      external_id: ids.feature(FEATURE.ZONE1_SET_TEMPERATURE),
      category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
      type: DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      min: ZONE_MIN_TEMPERATURE,
      max: ZONE_MAX_TEMPERATURE,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    {
      name: 'Zone 1 room temperature',
      external_id: ids.feature(FEATURE.ZONE1_ROOM_TEMPERATURE),
      category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      min: -10,
      max: 50,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    {
      name: 'Outdoor temperature',
      external_id: ids.feature(FEATURE.OUTDOOR_TEMPERATURE),
      category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
      unit: DEVICE_FEATURE_UNITS.CELSIUS,
      min: -40,
      max: 50,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
  ];

  // Domestic hot water tank features only exist when the unit has a tank.
  if (hasHotWater) {
    features.push(
      {
        name: 'Hot water temperature',
        external_id: ids.feature(FEATURE.TANK_SET_TEMPERATURE),
        category: DEVICE_FEATURE_CATEGORIES.THERMOSTAT,
        type: DEVICE_FEATURE_TYPES.THERMOSTAT.TARGET_TEMPERATURE,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: tank.min,
        max: tank.max,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'Hot water tank temperature',
        external_id: ids.feature(FEATURE.TANK_TEMPERATURE),
        category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: 0,
        max: 80,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      {
        name: 'Forced hot water',
        external_id: ids.feature(FEATURE.FORCED_HOT_WATER),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
    );
  }

  return {
    name: unit.givenDisplayName || unit.id,
    external_id: ids.device,
    model: unit.connectedInterfaceType || undefined,
    // `poll_frequency` alone does NOT enable polling: the Gladys scheduler only
    // picks up devices whose `should_poll` is true.
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    features,
  };
}

/**
 * Build the list of feature states to publish for a unit.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-water unit.
 * @returns {Array} States as { device_feature_external_id, state }.
 */
export function readStates(gladys, unit) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const states = [
    {
      device_feature_external_id: ids.feature(FEATURE.POWER),
      state: toBoolean(getSetting(unit, 'Power')) ? 1 : 0,
    },
  ];

  const pushNumber = (feature, name) => {
    const value = toNumber(getSetting(unit, name));
    if (value !== null) {
      states.push({ device_feature_external_id: ids.feature(feature), state: value });
    }
  };

  pushNumber(FEATURE.ZONE1_SET_TEMPERATURE, 'SetTemperatureZone1');
  pushNumber(FEATURE.ZONE1_ROOM_TEMPERATURE, 'RoomTemperatureZone1');
  pushNumber(FEATURE.OUTDOOR_TEMPERATURE, 'OutdoorTemperature');

  if (getSetting(unit, 'SetTankWaterTemperature') !== undefined) {
    pushNumber(FEATURE.TANK_SET_TEMPERATURE, 'SetTankWaterTemperature');
    pushNumber(FEATURE.TANK_TEMPERATURE, 'TankWaterTemperature');
    states.push({
      device_feature_external_id: ids.feature(FEATURE.FORCED_HOT_WATER),
      state: toBoolean(getSetting(unit, 'ForcedHotWaterMode')) ? 1 : 0,
    });
  }

  return states;
}

/**
 * Build the empty control body (every field null).
 * @returns {object} The null control payload.
 */
export function buildNullPayload() {
  const payload = {};
  CONTROL_FIELDS.forEach((field) => {
    payload[field] = null;
  });
  return payload;
}

/**
 * Build the command payload for a single feature change. The BFF expects the
 * full control body with only the changed field set and the rest null.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-water unit.
 * @param {string} featureExternalId - The changed feature external id.
 * @param {number} value - The Gladys value.
 * @returns {object|null} The full payload, or null if the feature is not writable.
 */
export function buildSetPayload(gladys, unit, featureExternalId, value) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  let overlay = null;
  if (featureExternalId === ids.feature(FEATURE.POWER)) {
    overlay = { power: value === 1 };
  } else if (featureExternalId === ids.feature(FEATURE.FORCED_HOT_WATER)) {
    overlay = { forcedHotWaterMode: value === 1 };
  } else if (featureExternalId === ids.feature(FEATURE.TANK_SET_TEMPERATURE)) {
    overlay = { setTankWaterTemperature: value };
  } else if (featureExternalId === ids.feature(FEATURE.ZONE1_SET_TEMPERATURE)) {
    overlay = { setTemperatureZone1: value };
  }
  if (overlay === null) {
    return null;
  }
  return { ...buildNullPayload(), ...overlay };
}

/**
 * Find the unit whose device external id matches, from a list of units.
 * @param {object} gladys - The SDK instance.
 * @param {Array} units - Air-to-water units.
 * @param {string} deviceExternalId - The device external id to match.
 * @returns {object|undefined} The matching unit.
 */
export function findUnitByExternalId(gladys, units, deviceExternalId) {
  return units.find((unit) => gladys.externalIds(DEVICE_TYPE, unit.id).device === deviceExternalId);
}
