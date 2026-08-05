import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeGladys } from './helpers/fakeGladys.js';

import {
  buildDevice,
  readStates,
  buildFullPayload,
  buildSetPayload,
  getSetting,
  findUnitByExternalId,
  AC_MODE,
} from '../src/devices/airToAir.js';

const gladys = createFakeGladys();

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

test('buildDevice maps unit to a Gladys device with 4 features', () => {
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
