// -----------------------------------------------------------------------------
// Device type: AIR-TO-AIR unit (air conditioner).
//
// Maps a MELCloud Home air-to-air unit to a Gladys device with four features:
//   - power              (on/off)
//   - mode               (heat / cool / dry / fan / auto)
//   - target temperature (set point)
//   - room temperature   (read-only)
//
// MELCloud Home returns the state as a `settings: [{name, value}]` array where
// every value is a STRING ("True", "Cool", "28"...). Commands are sent as a full
// flat camelCase object to `PUT /monitor/ataunit/{id}`, so a change is overlaid
// on the current full state to avoid resetting the other attributes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'ata';

export const FEATURE = {
  POWER: 'power',
  MODE: 'mode',
  TEMPERATURE: 'temperature',
  ROOM_TEMPERATURE: 'room-temperature',
};

// Gladys AC_MODE values (mirrors the Gladys core constants; the SDK does not
// export them).
export const AC_MODE = {
  AUTO: 0,
  COOLING: 1,
  HEATING: 2,
  DRYING: 3,
  FAN: 4,
};

// MELCloud Home air-to-air operation modes (REST string values).
export const ATA_OPERATION_MODE = {
  HEAT: 'Heat',
  DRY: 'Dry',
  COOL: 'Cool',
  FAN: 'Fan',
  AUTOMATIC: 'Automatic',
};

const MODE_TO_GLADYS = {
  [ATA_OPERATION_MODE.HEAT]: AC_MODE.HEATING,
  [ATA_OPERATION_MODE.DRY]: AC_MODE.DRYING,
  [ATA_OPERATION_MODE.COOL]: AC_MODE.COOLING,
  [ATA_OPERATION_MODE.FAN]: AC_MODE.FAN,
  [ATA_OPERATION_MODE.AUTOMATIC]: AC_MODE.AUTO,
};

const MODE_TO_MELCLOUD = {
  [AC_MODE.HEATING]: ATA_OPERATION_MODE.HEAT,
  [AC_MODE.DRYING]: ATA_OPERATION_MODE.DRY,
  [AC_MODE.COOLING]: ATA_OPERATION_MODE.COOL,
  [AC_MODE.FAN]: ATA_OPERATION_MODE.FAN,
  [AC_MODE.AUTO]: ATA_OPERATION_MODE.AUTOMATIC,
};

/**
 * Read a value from the unit `settings` array.
 * @param {object} unit - Air-to-air unit.
 * @param {string} name - Setting name.
 * @returns {string|undefined} The setting value.
 */
export function getSetting(unit, name) {
  const setting = (unit.settings || []).find((currentSetting) => currentSetting.name === name);
  return setting ? setting.value : undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getTemperatureBounds(unit) {
  const capabilities = unit.capabilities || {};
  const mins = [
    capabilities.minTempHeat,
    capabilities.minTempCoolDry,
    capabilities.minTempAutomatic,
  ].filter((value) => typeof value === 'number');
  const maxs = [
    capabilities.maxTempHeat,
    capabilities.maxTempCoolDry,
    capabilities.maxTempAutomatic,
  ].filter((value) => typeof value === 'number');
  return {
    min: mins.length > 0 ? Math.min(...mins) : 10,
    max: maxs.length > 0 ? Math.max(...maxs) : 31,
  };
}

/**
 * Build the Gladys discovery payload for one air-to-air unit.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {object} config - Integration config.
 * @returns {object} The Gladys device.
 */
export function buildDevice(gladys, unit, config) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const { min, max } = getTemperatureBounds(unit);
  return {
    name: unit.givenDisplayName || unit.id,
    external_id: ids.device,
    // The API exposes no AC model; the Wi-Fi interface type is the only descriptor.
    model: unit.connectedInterfaceType || undefined,
    // `poll_frequency` alone does NOT enable polling: the Gladys scheduler only
    // picks up devices whose `should_poll` is true.
    should_poll: true,
    poll_frequency: config.poll_frequency,
    features: [
      {
        name: 'Power',
        external_id: ids.feature(FEATURE.POWER),
        category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
        type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'Mode',
        external_id: ids.feature(FEATURE.MODE),
        category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
        type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.MODE,
        // The AC_MODE range, not a binary: auto(0) -> fan(4).
        min: AC_MODE.AUTO,
        max: AC_MODE.FAN,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'Temperature',
        external_id: ids.feature(FEATURE.TEMPERATURE),
        category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
        type: DEVICE_FEATURE_TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min,
        max,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'Room temperature',
        external_id: ids.feature(FEATURE.ROOM_TEMPERATURE),
        category: DEVICE_FEATURE_CATEGORIES.TEMPERATURE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.CELSIUS,
        min: -10,
        max: 50,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

/**
 * Build the list of feature states to publish for a unit.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @returns {Array} States as { device_feature_external_id, state }.
 */
export function readStates(gladys, unit) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const power = getSetting(unit, 'Power') === 'True' ? 1 : 0;
  const mode = MODE_TO_GLADYS[getSetting(unit, 'OperationMode')];
  const setTemperature = toNumber(getSetting(unit, 'SetTemperature'));
  const roomTemperature = toNumber(getSetting(unit, 'RoomTemperature'));

  const states = [{ device_feature_external_id: ids.feature(FEATURE.POWER), state: power }];
  if (mode !== undefined) {
    states.push({ device_feature_external_id: ids.feature(FEATURE.MODE), state: mode });
  }
  if (setTemperature !== null) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.TEMPERATURE),
      state: setTemperature,
    });
  }
  if (roomTemperature !== null) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.ROOM_TEMPERATURE),
      state: roomTemperature,
    });
  }
  return states;
}

/**
 * Build the full command payload from a unit's current state.
 * @param {object} unit - Air-to-air unit.
 * @returns {object} The full command payload.
 */
export function buildFullPayload(unit) {
  return {
    power: getSetting(unit, 'Power') === 'True',
    operationMode: getSetting(unit, 'OperationMode'),
    setTemperature: toNumber(getSetting(unit, 'SetTemperature')),
    setFanSpeed: getSetting(unit, 'SetFanSpeed'),
    vaneVerticalDirection: getSetting(unit, 'VaneVerticalDirection'),
    vaneHorizontalDirection: getSetting(unit, 'VaneHorizontalDirection'),
    temperatureIncrementOverride: null,
    inStandbyMode: getSetting(unit, 'InStandbyMode') === 'True',
  };
}

/**
 * Build the command payload for a single feature change, merged onto the
 * unit's current full state.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {string} featureExternalId - The changed feature external id.
 * @param {number} value - The Gladys value.
 * @returns {object|null} The full payload, or null if the feature is not writable.
 */
export function buildSetPayload(gladys, unit, featureExternalId, value) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  let overlay = null;
  if (featureExternalId === ids.feature(FEATURE.POWER)) {
    overlay = { power: value === 1 };
  } else if (featureExternalId === ids.feature(FEATURE.MODE)) {
    overlay = { operationMode: MODE_TO_MELCLOUD[value] };
  } else if (featureExternalId === ids.feature(FEATURE.TEMPERATURE)) {
    overlay = { setTemperature: value };
  }
  if (overlay === null) {
    return null;
  }
  return { ...buildFullPayload(unit), ...overlay };
}

/**
 * Find the unit whose device external id matches, from a list of units.
 * @param {object} gladys - The SDK instance.
 * @param {Array} units - Air-to-air units.
 * @param {string} deviceExternalId - The device external id to match.
 * @returns {object|undefined} The matching unit.
 */
export function findUnitByExternalId(gladys, units, deviceExternalId) {
  return units.find((unit) => gladys.externalIds(DEVICE_TYPE, unit.id).device === deviceExternalId);
}
