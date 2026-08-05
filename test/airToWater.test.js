import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeGladys } from './helpers/fakeGladys.js';

import {
  buildDevice,
  readStates,
  buildNullPayload,
  buildSetPayload,
  getSetting,
  findUnitByExternalId,
  FEATURE,
} from '../src/devices/airToWater.js';

const gladys = createFakeGladys();

// Shaped after the real /context fixture (erwindouna/aiomelcloudhome).
const buildUnit = (overrides = {}) => ({
  id: 'atw-1',
  givenDisplayName: 'Ecodan',
  connectedInterfaceType: 'fourthGenWifi',
  buildingId: 'b1',
  capabilities: {
    hasHotWater: true,
    hasZone2: false,
    hasCoolingMode: false,
    minSetTankTemperature: 40,
    maxSetTankTemperature: 60,
  },
  settings: [
    { name: 'Power', value: 'True' },
    { name: 'OperationMode', value: 'HeatZones' },
    { name: 'OperationModeZone1', value: 'HeatRoomTemperature' },
    { name: 'SetTemperatureZone1', value: '21' },
    { name: 'RoomTemperatureZone1', value: '20' },
    { name: 'SetTankWaterTemperature', value: '50' },
    { name: 'TankWaterTemperature', value: '48' },
    { name: 'ForcedHotWaterMode', value: 'False' },
    { name: 'HasZone2', value: '0' },
    { name: 'InStandbyMode', value: 'False' },
    { name: 'IsInError', value: 'False' },
  ],
  ...overrides,
});

const featureId = (feature) => gladys.externalIds('atw', 'atw-1').feature(feature);

test('getSetting reads a value from the settings array', () => {
  const unit = buildUnit();
  assert.equal(getSetting(unit, 'SetTankWaterTemperature'), '50');
  assert.equal(getSetting(unit, 'Missing'), undefined);
});

test('buildDevice exposes the expected features with hot water', () => {
  const device = buildDevice(gladys, buildUnit());
  assert.equal(device.name, 'Ecodan');
  assert.equal(device.external_id, gladys.externalIds('atw', 'atw-1').device);
  assert.equal(device.model, 'fourthGenWifi');
  assert.equal(device.poll_frequency, 60000);
  assert.equal(device.should_poll, true);
  // The core derives the selector at creation; an integration publishes none.
  assert.equal(device.selector, undefined);
  const ids = device.features.map((f) => f.external_id);
  for (const feature of [
    FEATURE.POWER,
    FEATURE.ZONE1_SET_TEMPERATURE,
    FEATURE.ZONE1_ROOM_TEMPERATURE,
    FEATURE.OUTDOOR_TEMPERATURE,
    FEATURE.TANK_SET_TEMPERATURE,
    FEATURE.TANK_TEMPERATURE,
    FEATURE.FORCED_HOT_WATER,
  ]) {
    assert.ok(ids.includes(featureId(feature)), `missing feature ${feature}`);
  }
});

test('buildDevice uses tank bounds from capabilities', () => {
  const device = buildDevice(gladys, buildUnit());
  const tank = device.features.find(
    (f) => f.external_id === featureId(FEATURE.TANK_SET_TEMPERATURE),
  );
  assert.equal(tank.min, 40);
  assert.equal(tank.max, 60);
});

test('buildDevice omits hot water features when the unit has no tank', () => {
  const unit = buildUnit({
    capabilities: { hasHotWater: false },
    settings: [
      { name: 'Power', value: 'True' },
      { name: 'SetTemperatureZone1', value: '21' },
      { name: 'RoomTemperatureZone1', value: '20' },
    ],
  });
  const device = buildDevice(gladys, unit);
  const ids = device.features.map((f) => f.external_id);
  assert.ok(!ids.includes(featureId(FEATURE.TANK_SET_TEMPERATURE)));
  assert.ok(!ids.includes(featureId(FEATURE.FORCED_HOT_WATER)));
  assert.ok(ids.includes(featureId(FEATURE.POWER)));
});

test('readStates parses power, temperatures and forced hot water', () => {
  const states = readStates(gladys, buildUnit());
  const byId = Object.fromEntries(states.map((s) => [s.device_feature_external_id, s.state]));
  assert.equal(byId[featureId(FEATURE.POWER)], 1);
  assert.equal(byId[featureId(FEATURE.ZONE1_SET_TEMPERATURE)], 21);
  assert.equal(byId[featureId(FEATURE.ZONE1_ROOM_TEMPERATURE)], 20);
  assert.equal(byId[featureId(FEATURE.TANK_SET_TEMPERATURE)], 50);
  assert.equal(byId[featureId(FEATURE.TANK_TEMPERATURE)], 48);
  assert.equal(byId[featureId(FEATURE.FORCED_HOT_WATER)], 0);
});

test('readStates omits outdoor temperature when the setting is absent', () => {
  const states = readStates(gladys, buildUnit());
  const ids = states.map((s) => s.device_feature_external_id);
  assert.ok(!ids.includes(featureId(FEATURE.OUTDOOR_TEMPERATURE)));
});

test('readStates includes outdoor temperature when present', () => {
  const unit = buildUnit();
  unit.settings.push({ name: 'OutdoorTemperature', value: '7.5' });
  const states = readStates(gladys, unit);
  const byId = Object.fromEntries(states.map((s) => [s.device_feature_external_id, s.state]));
  assert.equal(byId[featureId(FEATURE.OUTDOOR_TEMPERATURE)], 7.5);
});

test('readStates omits tank states when the unit has no tank', () => {
  const unit = buildUnit({
    settings: [
      { name: 'Power', value: 'False' },
      { name: 'SetTemperatureZone1', value: '19' },
      { name: 'RoomTemperatureZone1', value: '18' },
    ],
  });
  const states = readStates(gladys, unit);
  const ids = states.map((s) => s.device_feature_external_id);
  assert.ok(!ids.includes(featureId(FEATURE.TANK_SET_TEMPERATURE)));
  assert.ok(!ids.includes(featureId(FEATURE.FORCED_HOT_WATER)));
  const byId = Object.fromEntries(states.map((s) => [s.device_feature_external_id, s.state]));
  assert.equal(byId[featureId(FEATURE.POWER)], 0);
});

test('buildNullPayload sets every control field to null', () => {
  const payload = buildNullPayload();
  assert.equal(payload.power, null);
  assert.equal(payload.setTankWaterTemperature, null);
  assert.equal(payload.setTemperatureZone1, null);
  assert.equal(payload.operationModeZone1, null);
  assert.ok('setCoolFlowTemperatureZone2' in payload);
});

test('buildSetPayload sends a full body with only the changed field set', () => {
  const unit = buildUnit();
  const payload = buildSetPayload(gladys, unit, featureId(FEATURE.TANK_SET_TEMPERATURE), 52);
  assert.equal(payload.setTankWaterTemperature, 52);
  assert.equal(payload.power, null);
  assert.equal(payload.setTemperatureZone1, null);
});

test('buildSetPayload maps power and forced hot water to booleans', () => {
  const unit = buildUnit();
  assert.equal(buildSetPayload(gladys, unit, featureId(FEATURE.POWER), 1).power, true);
  assert.equal(buildSetPayload(gladys, unit, featureId(FEATURE.POWER), 0).power, false);
  assert.equal(
    buildSetPayload(gladys, unit, featureId(FEATURE.FORCED_HOT_WATER), 1).forcedHotWaterMode,
    true,
  );
});

test('buildSetPayload maps the zone 1 setpoint', () => {
  const unit = buildUnit();
  const payload = buildSetPayload(gladys, unit, featureId(FEATURE.ZONE1_SET_TEMPERATURE), 22);
  assert.equal(payload.setTemperatureZone1, 22);
});

test('buildSetPayload returns null for a read-only feature', () => {
  const unit = buildUnit();
  assert.equal(buildSetPayload(gladys, unit, featureId(FEATURE.TANK_TEMPERATURE), 45), null);
  assert.equal(buildSetPayload(gladys, unit, featureId(FEATURE.OUTDOOR_TEMPERATURE), 5), null);
});

test('findUnitByExternalId matches on the device external id', () => {
  const units = [buildUnit(), buildUnit({ id: 'atw-2' })];
  const deviceExternalId = gladys.externalIds('atw', 'atw-2').device;
  const found = findUnitByExternalId(gladys, units, deviceExternalId);
  assert.equal(found.id, 'atw-2');
});
