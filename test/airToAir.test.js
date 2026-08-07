import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeGladys } from './helpers/fakeGladys.js';

import { buildCapabilities } from '../src/capabilities.js';
import {
  buildDevice,
  readStates,
  buildFullPayload,
  buildSetPayload,
  getSetting,
  findUnitByExternalId,
  AC_MODE,
  AC_SWING_VERTICAL,
  AC_SWING_HORIZONTAL,
  AC_FAN_SPEED,
} from '../src/devices/airToAir.js';

const gladys = createFakeGladys();

// The vane features only exist on Gladys 4.84.2+ (see src/capabilities.js).
const SWING = buildCapabilities('4.84.2');

const buildUnit = (overrides = {}) => ({
  id: 'unit-1',
  givenDisplayName: 'Salon',
  connectedInterfaceType: 'fourthGenWifi',
  buildingId: 'b1',
  capabilities: {
    minTempHeat: 8,
    maxTempHeat: 31,
    minTempCoolDry: 16,
    maxTempCoolDry: 31,
    minTempAutomatic: 16,
    maxTempAutomatic: 31,
  },
  settings: [
    { name: 'Power', value: 'True' },
    { name: 'OperationMode', value: 'Cool' },
    { name: 'SetTemperature', value: '21' },
    { name: 'RoomTemperature', value: '23.5' },
    { name: 'SetFanSpeed', value: 'Four' },
    { name: 'VaneVerticalDirection', value: 'Swing' },
    { name: 'VaneHorizontalDirection', value: 'Auto' },
    { name: 'InStandbyMode', value: 'False' },
  ],
  ...overrides,
});

test('getSetting reads a value or undefined', () => {
  assert.equal(getSetting(buildUnit(), 'Power'), 'True');
  assert.equal(getSetting(buildUnit(), 'Nope'), undefined);
  assert.equal(getSetting({}, 'Power'), undefined);
});

test('buildDevice maps unit to a Gladys device with 4 base features', () => {
  const device = buildDevice(gladys, buildUnit());
  assert.equal(device.name, 'Salon');
  assert.equal(device.external_id, 'ext:test:ata:unit-1');
  assert.equal(device.model, 'fourthGenWifi');
  assert.equal(device.poll_frequency, 60000);
  // `poll_frequency` alone is inert: the Gladys scheduler polls the devices
  // flagged `should_poll`.
  assert.equal(device.should_poll, true);
  assert.equal(device.features.length, 4);
  const temp = device.features.find((f) => f.external_id.endsWith(':temperature'));
  assert.equal(temp.min, 8);
  assert.equal(temp.max, 31);

  // No selector is published: the core derives a unique one at creation
  // (buildUniqueSelector) and strips any selector sent by an integration.
  assert.equal(device.selector, undefined);
  device.features.forEach((f) => assert.equal(f.selector, undefined));
});

test('buildDevice exposes the full AC mode range', () => {
  const device = buildDevice(gladys, buildUnit());
  const mode = device.features.find((f) => f.external_id.endsWith(':mode'));
  assert.equal(mode.min, AC_MODE.AUTO);
  assert.equal(mode.max, AC_MODE.FAN);
  Object.values(AC_MODE).forEach((value) => {
    assert.ok(value >= mode.min && value <= mode.max, `mode ${value} is within bounds`);
  });
});

test('buildDevice falls back to unit id and default bounds', () => {
  const device = buildDevice(gladys, { id: 'x', settings: [] });
  assert.equal(device.name, 'x');
  assert.equal(device.model, undefined);
  const temp = device.features.find((f) => f.external_id.endsWith(':temperature'));
  assert.equal(temp.min, 10);
  assert.equal(temp.max, 31);
});

test('readStates publishes power, mode and temperatures', () => {
  const states = readStates(gladys, buildUnit());
  assert.deepEqual(states, [
    { device_feature_external_id: 'ext:test:ata:unit-1:power', state: 1 },
    { device_feature_external_id: 'ext:test:ata:unit-1:mode', state: AC_MODE.COOLING },
    { device_feature_external_id: 'ext:test:ata:unit-1:temperature', state: 21 },
    { device_feature_external_id: 'ext:test:ata:unit-1:room-temperature', state: 23.5 },
    { device_feature_external_id: 'ext:test:ata:unit-1:fan-speed', state: AC_FAN_SPEED.MID_HIGH },
    {
      device_feature_external_id: 'ext:test:ata:unit-1:swing-vertical',
      state: AC_SWING_VERTICAL.SWING,
    },
    {
      device_feature_external_id: 'ext:test:ata:unit-1:swing-horizontal',
      state: AC_SWING_HORIZONTAL.OFF,
    },
  ]);
});

test('readStates skips an unknown mode and non-numeric temperatures', () => {
  const states = readStates(
    gladys,
    buildUnit({
      settings: [
        { name: 'Power', value: 'False' },
        { name: 'OperationMode', value: 'Weird' },
        { name: 'SetTemperature', value: '' },
        { name: 'RoomTemperature', value: 'abc' },
      ],
    }),
  );
  assert.deepEqual(states, [{ device_feature_external_id: 'ext:test:ata:unit-1:power', state: 0 }]);
});

test('buildFullPayload reflects the current state', () => {
  assert.deepEqual(buildFullPayload(buildUnit()), {
    power: true,
    operationMode: 'Cool',
    setTemperature: 21,
    setFanSpeed: 'Four',
    vaneVerticalDirection: 'Swing',
    vaneHorizontalDirection: 'Auto',
    temperatureIncrementOverride: null,
    inStandbyMode: false,
  });
});

test('buildSetPayload merges the change onto the full state', () => {
  const unit = buildUnit();
  const power = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:power', 0);
  assert.equal(power.power, false);
  assert.equal(power.operationMode, 'Cool'); // preserved

  const mode = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:mode', AC_MODE.HEATING);
  assert.equal(mode.operationMode, 'Heat');

  const temp = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:temperature', 22);
  assert.equal(temp.setTemperature, 22);
});

test('buildSetPayload returns null for a read-only feature', () => {
  assert.equal(
    buildSetPayload(gladys, buildUnit(), 'ext:test:ata:unit-1:room-temperature', 22),
    null,
  );
});

test('findUnitByExternalId matches by device external id', () => {
  const units = [buildUnit({ id: 'a' }), buildUnit({ id: 'b' })];
  const found = findUnitByExternalId(gladys, units, 'ext:test:ata:b');
  assert.equal(found.id, 'b');
  assert.equal(findUnitByExternalId(gladys, units, 'ext:test:ata:z'), undefined);
});

// --- Vanes (swing) -----------------------------------------------------------

test('buildDevice exposes both swing features when the unit reports vanes', () => {
  const device = buildDevice(gladys, buildUnit(), SWING);
  const vertical = device.features.find((f) => f.external_id.endsWith(':swing-vertical'));
  const horizontal = device.features.find((f) => f.external_id.endsWith(':swing-horizontal'));

  assert.equal(vertical.type, 'swing-vertical');
  assert.equal(horizontal.type, 'swing-horizontal');
  [vertical, horizontal].forEach((feature) => {
    assert.equal(feature.category, 'air-conditioning');
    assert.equal(feature.read_only, false);
    assert.equal(feature.min, 0);
    assert.equal(feature.max, 6);
    // Gladys offers only the positions declared here instead of its full catalog.
    assert.equal(feature.supported_options.length, 7);
    feature.supported_options.forEach((option, index) => {
      assert.equal(option.value, index);
      assert.equal(option.sort_order, index);
      assert.ok(option.label.length > 0);
    });
  });
  assert.equal(horizontal.supported_options[2].label, 'Left');
});

test('buildDevice omits a swing feature the unit does not report', () => {
  const unit = buildUnit({
    settings: [
      { name: 'Power', value: 'True' },
      { name: 'VaneVerticalDirection', value: 'Auto' },
    ],
  });
  const ids = buildDevice(gladys, unit, SWING).features.map((f) => f.external_id);
  assert.ok(ids.some((id) => id.endsWith(':swing-vertical')));
  assert.ok(!ids.some((id) => id.endsWith(':swing-horizontal')));
});

test('readStates maps the vane directions to the Gladys swing values', () => {
  const states = readStates(
    gladys,
    buildUnit({
      settings: [
        { name: 'Power', value: 'True' },
        { name: 'VaneVerticalDirection', value: 'Swing' },
        { name: 'VaneHorizontalDirection', value: 'Centre' },
      ],
    }),
  );
  const byId = Object.fromEntries(states.map((s) => [s.device_feature_external_id, s.state]));
  assert.equal(byId['ext:test:ata:unit-1:swing-vertical'], AC_SWING_VERTICAL.SWING);
  assert.equal(byId['ext:test:ata:unit-1:swing-horizontal'], AC_SWING_HORIZONTAL.POSITION_3);
});

test('readStates maps "Auto" onto the off slot Gladys imposes', () => {
  const states = readStates(
    gladys,
    buildUnit({
      settings: [
        { name: 'Power', value: 'True' },
        { name: 'VaneVerticalDirection', value: 'Auto' },
        { name: 'VaneHorizontalDirection', value: 'Auto' },
      ],
    }),
  );
  const byId = Object.fromEntries(states.map((s) => [s.device_feature_external_id, s.state]));
  assert.equal(byId['ext:test:ata:unit-1:swing-vertical'], AC_SWING_VERTICAL.OFF);
  assert.equal(byId['ext:test:ata:unit-1:swing-horizontal'], AC_SWING_HORIZONTAL.OFF);
});

test('readStates also accepts the integer vane codes', () => {
  // The real-time feed sends codes, and they are NOT the string order:
  // vertical Swing is 6, horizontal Swing is 7.
  const states = readStates(
    gladys,
    buildUnit({
      settings: [
        { name: 'Power', value: 'True' },
        { name: 'VaneVerticalDirection', value: 6 },
        { name: 'VaneHorizontalDirection', value: '7' },
      ],
    }),
  );
  const byId = Object.fromEntries(states.map((s) => [s.device_feature_external_id, s.state]));
  assert.equal(byId['ext:test:ata:unit-1:swing-vertical'], AC_SWING_VERTICAL.SWING);
  assert.equal(byId['ext:test:ata:unit-1:swing-horizontal'], AC_SWING_HORIZONTAL.SWING);
});

test('readStates skips an unknown vane direction', () => {
  const states = readStates(
    gladys,
    buildUnit({
      settings: [
        { name: 'Power', value: 'True' },
        { name: 'VaneVerticalDirection', value: 'Nope' },
      ],
    }),
  );
  const ids = states.map((s) => s.device_feature_external_id);
  assert.ok(!ids.includes('ext:test:ata:unit-1:swing-vertical'));
});

test('buildSetPayload sends the vane direction and preserves the rest', () => {
  const unit = buildUnit();

  const vertical = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:swing-vertical', 4);
  assert.equal(vertical.vaneVerticalDirection, 'Three');
  assert.equal(vertical.vaneHorizontalDirection, 'Auto'); // untouched
  assert.equal(vertical.operationMode, 'Cool');

  const horizontal = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:swing-horizontal', 1);
  assert.equal(horizontal.vaneHorizontalDirection, 'Swing');
  assert.equal(horizontal.vaneVerticalDirection, 'Swing'); // the unit's current value
});

test('buildSetPayload maps every swing value both ways', () => {
  const unit = buildUnit();
  Object.values(AC_SWING_VERTICAL).forEach((value) => {
    const payload = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:swing-vertical', value);
    assert.ok(payload, `vertical ${value} is writable`);
    assert.equal(
      readStates(gladys, {
        ...unit,
        settings: [{ name: 'VaneVerticalDirection', value: payload.vaneVerticalDirection }],
      }).find((s) => s.device_feature_external_id.endsWith(':swing-vertical')).state,
      value,
      `vertical ${value} round-trips`,
    );
  });
  Object.values(AC_SWING_HORIZONTAL).forEach((value) => {
    const payload = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:swing-horizontal', value);
    assert.ok(payload, `horizontal ${value} is writable`);
  });
});

test('buildSetPayload rejects a swing value outside the mapping', () => {
  assert.equal(
    buildSetPayload(gladys, buildUnit(), 'ext:test:ata:unit-1:swing-vertical', 99),
    null,
  );
});

test('buildFullPayload normalizes vane codes to direction strings', () => {
  const payload = buildFullPayload(
    buildUnit({
      settings: [
        { name: 'Power', value: 'True' },
        { name: 'VaneVerticalDirection', value: 6 },
        { name: 'VaneHorizontalDirection', value: 3 },
      ],
    }),
  );
  assert.equal(payload.vaneVerticalDirection, 'Swing');
  assert.equal(payload.vaneHorizontalDirection, 'Centre');
});

test('buildDevice publishes no swing feature to a Gladys that predates them', () => {
  // Gladys < 4.84.2 rejects an unknown feature type and drops the WHOLE
  // discovery payload with it, so the vanes must simply not be offered.
  const device = buildDevice(gladys, buildUnit(), buildCapabilities('4.84.1'));
  assert.equal(device.features.length, 4);
  assert.ok(!device.features.some((f) => f.external_id.includes(':swing-')));
});

// --- Fan speed ---------------------------------------------------------------

test('buildDevice exposes the fan speed with the unit own number of speeds', () => {
  const device = buildDevice(gladys, buildUnit(), SWING);
  const fan = device.features.find((f) => f.external_id.endsWith(':fan-speed'));
  assert.equal(fan.type, 'fan-speed');
  assert.equal(fan.category, 'air-conditioning');
  assert.equal(fan.read_only, false);
  assert.equal(fan.min, AC_FAN_SPEED.AUTO);
  assert.equal(fan.max, AC_FAN_SPEED.HIGH);
  // No numberOfFanSpeeds in the fixture: the full range.
  assert.deepEqual(
    fan.supported_options.map((o) => o.value),
    [0, 1, 2, 3, 4, 5],
  );
});

test('a unit with fewer speeds only offers the ones it has', () => {
  const unit = buildUnit({ capabilities: { numberOfFanSpeeds: 3 } });
  const fan = buildDevice(gladys, unit, SWING).features.find((f) =>
    f.external_id.endsWith(':fan-speed'),
  );
  // Auto plus speeds 1-3, never a dead speed 4 or 5.
  assert.deepEqual(
    fan.supported_options.map((o) => o.value),
    [AC_FAN_SPEED.AUTO, AC_FAN_SPEED.LOW, AC_FAN_SPEED.LOW_MID, AC_FAN_SPEED.MID],
  );
  assert.deepEqual(
    fan.supported_options.map((o) => o.sort_order),
    [0, 1, 2, 3],
  );
});

test('an absurd number of speeds is clamped to what MELCloud defines', () => {
  [0, -1, 99, null, 'x'].forEach((numberOfFanSpeeds) => {
    const unit = buildUnit({ capabilities: { numberOfFanSpeeds } });
    const fan = buildDevice(gladys, unit, SWING).features.find((f) =>
      f.external_id.endsWith(':fan-speed'),
    );
    assert.equal(
      fan.supported_options.length,
      6,
      `${numberOfFanSpeeds} falls back to the full range`,
    );
  });
});

test('buildDevice omits the fan speed on a unit that reports none', () => {
  const unit = buildUnit({ settings: [{ name: 'Power', value: 'True' }] });
  const ids = buildDevice(gladys, unit, SWING).features.map((f) => f.external_id);
  assert.ok(!ids.some((id) => id.endsWith(':fan-speed')));
});

test('buildDevice omits the fan speed on a Gladys that predates it', () => {
  const device = buildDevice(gladys, buildUnit(), buildCapabilities('4.84.1'));
  assert.ok(!device.features.some((f) => f.external_id.endsWith(':fan-speed')));
});

test('readStates maps the fan speed, including the integer code form', () => {
  const read = (value) => {
    const states = readStates(gladys, buildUnit({ settings: [{ name: 'SetFanSpeed', value }] }));
    const match = states.find((s) => s.device_feature_external_id.endsWith(':fan-speed'));
    return match ? match.state : undefined;
  };
  assert.equal(read('Auto'), AC_FAN_SPEED.AUTO);
  assert.equal(read('One'), AC_FAN_SPEED.LOW);
  assert.equal(read('Five'), AC_FAN_SPEED.HIGH);
  assert.equal(read(3), AC_FAN_SPEED.MID);
  assert.equal(read('5'), AC_FAN_SPEED.HIGH);
  // "Off" only ever appears on ActualFanSpeed and has no Gladys equivalent.
  assert.equal(read('Off'), undefined);
  assert.equal(read('Nope'), undefined);
});

test('buildSetPayload round-trips every fan speed', () => {
  const unit = buildUnit();
  Object.values(AC_FAN_SPEED).forEach((value) => {
    const payload = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:fan-speed', value);
    assert.ok(payload, `speed ${value} is writable`);
    const back = readStates(
      gladys,
      buildUnit({ settings: [{ name: 'SetFanSpeed', value: payload.setFanSpeed }] }),
    ).find((s) => s.device_feature_external_id.endsWith(':fan-speed'));
    assert.equal(back.state, value, `speed ${value} round-trips`);
  });
});

test('buildSetPayload preserves the rest of the state and rejects an unknown speed', () => {
  const unit = buildUnit();
  const payload = buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:fan-speed', AC_FAN_SPEED.LOW);
  assert.equal(payload.setFanSpeed, 'One');
  assert.equal(payload.operationMode, 'Cool');
  assert.equal(payload.setTemperature, 21);
  assert.equal(buildSetPayload(gladys, unit, 'ext:test:ata:unit-1:fan-speed', 99), null);
});

test('buildFullPayload normalizes a fan speed code to its string', () => {
  const payload = buildFullPayload(buildUnit({ settings: [{ name: 'SetFanSpeed', value: 2 }] }));
  assert.equal(payload.setFanSpeed, 'Two');
});
