// -----------------------------------------------------------------------------
// Device type: AIR-TO-AIR unit (air conditioner).
//
// Maps a MELCloud Home air-to-air unit to a Gladys device:
//   - power               (on/off)
//   - mode                (heat / cool / dry / fan / auto)
//   - target temperature  (set point)
//   - room temperature    (read-only)
//   - vertical swing      (vane, only on units that report one)
//   - horizontal swing    (vane, only on units that report one)
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

import { POLL_FREQUENCY } from '../config.js';
import { DEFAULT_CAPABILITIES } from '../capabilities.js';

export const DEVICE_TYPE = 'ata';

// The SDK's constant mirror stops at `target-temperature`; the swing types are
// defined by the Gladys core (4.84.2+), which is what validates the payload.
const SWING_FEATURE_TYPE = {
  VERTICAL: 'swing-vertical',
  HORIZONTAL: 'swing-horizontal',
};

export const FEATURE = {
  POWER: 'power',
  MODE: 'mode',
  TEMPERATURE: 'temperature',
  ROOM_TEMPERATURE: 'room-temperature',
  SWING_VERTICAL: 'swing-vertical',
  SWING_HORIZONTAL: 'swing-horizontal',
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

// --- Vanes (swing) -----------------------------------------------------------
// Gladys swing values (mirrors the core AC_SWING_* constants; the SDK does not
// export them). Gladys imposes a fixed vocabulary — off / swing / position 1-5 —
// so MELCloud's "Auto" lands on the OFF slot: it is the only one that means
// "neither swinging nor pinned to a position". The Gladys UI labels that slot
// "off" whatever label we publish alongside it.
export const AC_SWING_VERTICAL = {
  OFF: 0,
  SWING: 1,
  POSITION_1: 2,
  POSITION_2: 3,
  POSITION_3: 4,
  POSITION_4: 5,
  POSITION_5: 6,
};

export const AC_SWING_HORIZONTAL = {
  OFF: 0,
  SWING: 1,
  POSITION_1: 2,
  POSITION_2: 3,
  POSITION_3: 4,
  POSITION_4: 5,
  POSITION_5: 6,
};

// MELCloud Home vane directions. `/context` reports them as these strings; the
// values are confirmed against two independent reverse-engineering efforts
// (erwindouna/aiomelcloudhome, mgcrea/homebridge-melcloud-home). Note the
// British spelling of "Centre".
export const VANE_VERTICAL = {
  AUTO: 'Auto',
  SWING: 'Swing',
  ONE: 'One',
  TWO: 'Two',
  THREE: 'Three',
  FOUR: 'Four',
  FIVE: 'Five',
};

export const VANE_HORIZONTAL = {
  AUTO: 'Auto',
  SWING: 'Swing',
  LEFT: 'Left',
  LEFT_CENTRE: 'LeftCentre',
  CENTRE: 'Centre',
  RIGHT_CENTRE: 'RightCentre',
  RIGHT: 'Right',
};

// The same field also travels as an integer code (the real-time WebSocket feed
// uses those, and a `/context` payload occasionally does too). Keeping the code
// tables lets us read either shape. Note the codes are NOT the string order:
// vertical Swing is 6, horizontal Swing is 7.
const VANE_VERTICAL_BY_CODE = {
  0: VANE_VERTICAL.AUTO,
  1: VANE_VERTICAL.ONE,
  2: VANE_VERTICAL.TWO,
  3: VANE_VERTICAL.THREE,
  4: VANE_VERTICAL.FOUR,
  5: VANE_VERTICAL.FIVE,
  6: VANE_VERTICAL.SWING,
};

const VANE_HORIZONTAL_BY_CODE = {
  0: VANE_HORIZONTAL.AUTO,
  1: VANE_HORIZONTAL.LEFT,
  2: VANE_HORIZONTAL.LEFT_CENTRE,
  3: VANE_HORIZONTAL.CENTRE,
  4: VANE_HORIZONTAL.RIGHT_CENTRE,
  5: VANE_HORIZONTAL.RIGHT,
  7: VANE_HORIZONTAL.SWING,
};

const SWING_VERTICAL_TO_GLADYS = {
  [VANE_VERTICAL.AUTO]: AC_SWING_VERTICAL.OFF,
  [VANE_VERTICAL.SWING]: AC_SWING_VERTICAL.SWING,
  [VANE_VERTICAL.ONE]: AC_SWING_VERTICAL.POSITION_1,
  [VANE_VERTICAL.TWO]: AC_SWING_VERTICAL.POSITION_2,
  [VANE_VERTICAL.THREE]: AC_SWING_VERTICAL.POSITION_3,
  [VANE_VERTICAL.FOUR]: AC_SWING_VERTICAL.POSITION_4,
  [VANE_VERTICAL.FIVE]: AC_SWING_VERTICAL.POSITION_5,
};

const SWING_HORIZONTAL_TO_GLADYS = {
  [VANE_HORIZONTAL.AUTO]: AC_SWING_HORIZONTAL.OFF,
  [VANE_HORIZONTAL.SWING]: AC_SWING_HORIZONTAL.SWING,
  [VANE_HORIZONTAL.LEFT]: AC_SWING_HORIZONTAL.POSITION_1,
  [VANE_HORIZONTAL.LEFT_CENTRE]: AC_SWING_HORIZONTAL.POSITION_2,
  [VANE_HORIZONTAL.CENTRE]: AC_SWING_HORIZONTAL.POSITION_3,
  [VANE_HORIZONTAL.RIGHT_CENTRE]: AC_SWING_HORIZONTAL.POSITION_4,
  [VANE_HORIZONTAL.RIGHT]: AC_SWING_HORIZONTAL.POSITION_5,
};

const invert = (map) =>
  Object.fromEntries(Object.entries(map).map(([melcloud, gladys]) => [gladys, melcloud]));

const SWING_VERTICAL_TO_MELCLOUD = invert(SWING_VERTICAL_TO_GLADYS);
const SWING_HORIZONTAL_TO_MELCLOUD = invert(SWING_HORIZONTAL_TO_GLADYS);

// The label is only a fallback in the Gladys UI (the static i18n key wins when
// there is one), but it documents what each slot really drives on the unit.
const SWING_VERTICAL_LABELS = {
  [AC_SWING_VERTICAL.OFF]: 'Auto',
  [AC_SWING_VERTICAL.SWING]: 'Swing',
  [AC_SWING_VERTICAL.POSITION_1]: 'Position 1',
  [AC_SWING_VERTICAL.POSITION_2]: 'Position 2',
  [AC_SWING_VERTICAL.POSITION_3]: 'Position 3',
  [AC_SWING_VERTICAL.POSITION_4]: 'Position 4',
  [AC_SWING_VERTICAL.POSITION_5]: 'Position 5',
};

const SWING_HORIZONTAL_LABELS = {
  [AC_SWING_HORIZONTAL.OFF]: 'Auto',
  [AC_SWING_HORIZONTAL.SWING]: 'Swing',
  [AC_SWING_HORIZONTAL.POSITION_1]: 'Left',
  [AC_SWING_HORIZONTAL.POSITION_2]: 'Left centre',
  [AC_SWING_HORIZONTAL.POSITION_3]: 'Centre',
  [AC_SWING_HORIZONTAL.POSITION_4]: 'Right centre',
  [AC_SWING_HORIZONTAL.POSITION_5]: 'Right',
};

/**
 * Normalize a vane setting to its MELCloud string, accepting the integer code.
 * @param {string|number|undefined} value - The raw setting value.
 * @param {object} byCode - The code table of that vane.
 * @returns {string|undefined} The MELCloud direction string.
 */
function toVaneDirection(value, byCode) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return byCode[value];
  }
  // A numeric string ("6") is a code; anything else is already a direction.
  return /^\d+$/.test(value) ? byCode[Number(value)] : value;
}

/**
 * Build the `supported_options` of a swing feature: Gladys then offers only
 * these positions instead of its full static catalog.
 * @param {object} labels - Label by Gladys value.
 * @returns {Array} The supported options.
 */
function buildSwingOptions(labels) {
  return Object.entries(labels).map(([value, label], index) => ({
    value: Number(value),
    label,
    sort_order: index,
  }));
}

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
 * @param {object} [capabilities] - What the Gladys instance supports.
 * @returns {object} The Gladys device.
 */
export function buildDevice(gladys, unit, capabilities = DEFAULT_CAPABILITIES) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const { min, max } = getTemperatureBounds(unit);
  const device = {
    name: unit.givenDisplayName || unit.id,
    external_id: ids.device,
    // The API exposes no AC model; the Wi-Fi interface type is the only descriptor.
    model: unit.connectedInterfaceType || undefined,
    // `poll_frequency` alone does NOT enable polling: the Gladys scheduler only
    // picks up devices whose `should_poll` is true.
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
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

  // Gladys < 4.84.2 does not know the swing feature types and rejects the WHOLE
  // discovery payload when it meets one, so the vanes are simply not offered
  // there (see src/capabilities.js).
  if (!capabilities.swing) {
    return device;
  }

  // Vanes are optional hardware: only the units that actually report a vane
  // setting get the feature, so a model without one shows no dead control.
  if (getSetting(unit, 'VaneVerticalDirection') !== undefined) {
    device.features.push({
      name: 'Vertical swing',
      external_id: ids.feature(FEATURE.SWING_VERTICAL),
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: SWING_FEATURE_TYPE.VERTICAL,
      min: AC_SWING_VERTICAL.OFF,
      max: AC_SWING_VERTICAL.POSITION_5,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      supported_options: buildSwingOptions(SWING_VERTICAL_LABELS),
    });
  }

  if (getSetting(unit, 'VaneHorizontalDirection') !== undefined) {
    device.features.push({
      name: 'Horizontal swing',
      external_id: ids.feature(FEATURE.SWING_HORIZONTAL),
      category: DEVICE_FEATURE_CATEGORIES.AIR_CONDITIONING,
      type: SWING_FEATURE_TYPE.HORIZONTAL,
      min: AC_SWING_HORIZONTAL.OFF,
      max: AC_SWING_HORIZONTAL.POSITION_5,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      supported_options: buildSwingOptions(SWING_HORIZONTAL_LABELS),
    });
  }

  return device;
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

  const swingVertical =
    SWING_VERTICAL_TO_GLADYS[
      toVaneDirection(getSetting(unit, 'VaneVerticalDirection'), VANE_VERTICAL_BY_CODE)
    ];
  if (swingVertical !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.SWING_VERTICAL),
      state: swingVertical,
    });
  }

  const swingHorizontal =
    SWING_HORIZONTAL_TO_GLADYS[
      toVaneDirection(getSetting(unit, 'VaneHorizontalDirection'), VANE_HORIZONTAL_BY_CODE)
    ];
  if (swingHorizontal !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.SWING_HORIZONTAL),
      state: swingHorizontal,
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
    // Normalized: a unit reporting the integer code must not have it echoed
    // back as a code in a body the API reads as direction strings.
    vaneVerticalDirection:
      toVaneDirection(getSetting(unit, 'VaneVerticalDirection'), VANE_VERTICAL_BY_CODE) ?? null,
    vaneHorizontalDirection:
      toVaneDirection(getSetting(unit, 'VaneHorizontalDirection'), VANE_HORIZONTAL_BY_CODE) ?? null,
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
  } else if (featureExternalId === ids.feature(FEATURE.SWING_VERTICAL)) {
    const direction = SWING_VERTICAL_TO_MELCLOUD[value];
    overlay = direction ? { vaneVerticalDirection: direction } : null;
  } else if (featureExternalId === ids.feature(FEATURE.SWING_HORIZONTAL)) {
    const direction = SWING_HORIZONTAL_TO_MELCLOUD[value];
    overlay = direction ? { vaneHorizontalDirection: direction } : null;
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
