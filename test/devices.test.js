import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeGladys } from './helpers/fakeGladys.js';
import { COMMAND_SPACING, createDeviceRegistry, DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { createUnitCache } from '../src/devices/unitCache.js';

// A fake MELCloud Home client counting its calls, so the tests can assert how
// many times the account is actually fetched.
const createFakeApi = ({ ata = [], atw = [] } = {}) => {
  const calls = { listAta: 0, listAtw: 0, setAta: [], setAtw: [] };
  return {
    calls,
    async listAtaUnits() {
      calls.listAta += 1;
      return ata;
    },
    async listAtwUnits() {
      calls.listAtw += 1;
      return atw;
    },
    async setAtaUnit(unitId, payload) {
      calls.setAta.push({ unitId, payload });
    },
    async setAtwUnit(unitId, payload) {
      calls.setAtw.push({ unitId, payload });
    },
  };
};

const ataUnit = (id = 'unit-1') => ({
  id,
  givenDisplayName: `AC ${id}`,
  capabilities: {},
  settings: [
    { name: 'Power', value: 'True' },
    { name: 'OperationMode', value: 'Cool' },
    { name: 'SetTemperature', value: '21' },
    { name: 'RoomTemperature', value: '23' },
  ],
});

const atwUnit = (id = 'pump-1') => ({
  id,
  givenDisplayName: `Pump ${id}`,
  capabilities: { hasHotWater: false },
  settings: [
    { name: 'Power', value: 'True' },
    { name: 'SetTemperatureZone1', value: '20' },
    { name: 'RoomTemperatureZone1', value: '19' },
  ],
});

const setup = (units, cacheOptions) => {
  const gladys = createFakeGladys();
  const api = createFakeApi(units);
  const sleeps = [];
  const registry = createDeviceRegistry({
    gladys,
    cache: createUnitCache(cacheOptions),
    sleep: async (ms) => {
      sleeps.push({ ms, commandsSent: api.calls.setAta.length });
    },
  });
  return { gladys, api, registry, sleeps };
};

test('the registry serves both device families', () => {
  assert.deepEqual(
    DEVICE_BLUEPRINTS.map((blueprint) => blueprint.key),
    ['ata', 'atw'],
  );
});

test('buildDiscoveredDevices returns every unit of every family', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a'), ataUnit('b')], atw: [atwUnit('p')] });
  const devices = await registry.buildDiscoveredDevices(api);
  assert.deepEqual(
    devices.map((device) => device.external_id),
    ['ext:test:ata:a', 'ext:test:ata:b', 'ext:test:atw:p'],
  );
});

test('polling several devices of one family fetches the account once', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a'), ataUnit('b'), ataUnit('c')] });

  // The Gladys scheduler fires one onPoll per device in the same tick: before
  // the cache, that was one full account fetch per device, per minute.
  await Promise.all(
    ['a', 'b', 'c'].map((id) => registry.readStates(api, { external_id: `ext:test:ata:${id}` })),
  );

  assert.equal(api.calls.listAta, 1);
});

test('readStates routes a device to its own family', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')], atw: [atwUnit('p')] });

  const acStates = await registry.readStates(api, { external_id: 'ext:test:ata:a' });
  assert.ok(acStates.some((state) => state.device_feature_external_id === 'ext:test:ata:a:mode'));

  const pumpStates = await registry.readStates(api, { external_id: 'ext:test:atw:p' });
  assert.ok(
    pumpStates.some(
      (state) => state.device_feature_external_id === 'ext:test:atw:p:zone1-set-temperature',
    ),
  );
});

test('readStates returns null for a device that is not ours', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')] });
  assert.equal(await registry.readStates(api, { external_id: 'ext:test:ata:gone' }), null);
});

test('setValue sends the command to the right family and unit', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')], atw: [atwUnit('p')] });

  await registry.setValue(
    api,
    { external_id: 'ext:test:ata:a' },
    { external_id: 'ext:test:ata:a:temperature' },
    22,
  );
  assert.equal(api.calls.setAta.length, 1);
  assert.equal(api.calls.setAta[0].unitId, 'a');
  assert.equal(api.calls.setAta[0].payload.setTemperature, 22);
  assert.equal(api.calls.setAtw.length, 0);

  await registry.setValue(
    api,
    { external_id: 'ext:test:atw:p' },
    { external_id: 'ext:test:atw:p:zone1-set-temperature' },
    21,
  );
  assert.equal(api.calls.setAtw.length, 1);
  assert.equal(api.calls.setAtw[0].unitId, 'p');
});

test('setValue invalidates the cache so the next poll reads the new state', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')] });

  await registry.readStates(api, { external_id: 'ext:test:ata:a' });
  assert.equal(api.calls.listAta, 1);

  await registry.setValue(
    api,
    { external_id: 'ext:test:ata:a' },
    { external_id: 'ext:test:ata:a:power' },
    0,
  );

  await registry.readStates(api, { external_id: 'ext:test:ata:a' });
  assert.equal(api.calls.listAta, 2, 'the post-command poll must not be served from the cache');
});

test('setValue rejects an unknown device and a read-only feature', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')] });

  await assert.rejects(
    () => registry.setValue(api, { external_id: 'ext:test:ata:gone' }, { external_id: 'x' }, 1),
    /unit not found/,
  );
  await assert.rejects(
    () =>
      registry.setValue(
        api,
        { external_id: 'ext:test:ata:a' },
        { external_id: 'ext:test:ata:a:room-temperature' },
        20,
      ),
    /not writable/,
  );
});

test('setValues sends several changes as one command, then invalidates the cache', async () => {
  const { api, registry, sleeps } = setup({ ata: [ataUnit('a')] });
  await registry.readStates(api, { external_id: 'ext:test:ata:a' });

  const reported = await registry.setValues(api, { external_id: 'ext:test:ata:a' }, [
    { featureExternalId: 'ext:test:ata:a:mode', value: 2 },
    { featureExternalId: 'ext:test:ata:a:temperature', value: 23 },
  ]);
  assert.equal(api.calls.setAta.length, 1);
  assert.equal(api.calls.setAta[0].unitId, 'a');
  assert.equal(api.calls.setAta[0].payload.operationMode, 'Heat');
  assert.equal(api.calls.setAta[0].payload.setTemperature, 23);
  // Power is not part of the change: it stays null, the unit keeps its state.
  assert.equal(api.calls.setAta[0].payload.power, null);
  assert.deepEqual(sleeps, []);

  // The states read before the command, for the pending values.
  assert.equal(
    reported.find((state) => state.device_feature_external_id === 'ext:test:ata:a:temperature')
      .state,
    21,
  );

  await registry.readStates(api, { external_id: 'ext:test:ata:a' });
  assert.equal(api.calls.listAta, 2, 'the post-command poll must not be served from the cache');
});

test('setValues sends the two vane axes as two commands, spaced', async () => {
  const { api, registry, sleeps } = setup({ ata: [ataUnit('a')] });

  await registry.setValues(api, { external_id: 'ext:test:ata:a' }, [
    { featureExternalId: 'ext:test:ata:a:swing-vertical', value: 1 },
    { featureExternalId: 'ext:test:ata:a:swing-horizontal', value: 8 },
  ]);
  assert.deepEqual(
    api.calls.setAta.map(({ payload }) => [
      payload.vaneVerticalDirection,
      payload.vaneHorizontalDirection,
    ]),
    [
      ['Swing', null],
      [null, 'Auto'],
    ],
  );
  // One pause, between the two commands.
  assert.deepEqual(sleeps, [{ ms: COMMAND_SPACING, commandsSent: 1 }]);
});

test('setValue returns the states read before the command', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')] });
  const reported = await registry.setValue(
    api,
    { external_id: 'ext:test:ata:a' },
    { external_id: 'ext:test:ata:a:power' },
    0,
  );
  assert.equal(
    reported.find((state) => state.device_feature_external_id === 'ext:test:ata:a:power').state,
    1,
  );
  assert.equal(api.calls.setAta[0].payload.power, false);
  assert.equal(api.calls.setAta[0].payload.operationMode, null);
});

test('setValues rejects an unknown device, an unwritable change and a family without it', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')], atw: [atwUnit('p')] });
  const change = (featureExternalId) => [{ featureExternalId, value: 1 }];

  await assert.rejects(
    () => registry.setValues(api, { external_id: 'ext:test:ata:gone' }, change('x')),
    /unit not found/,
  );
  await assert.rejects(
    () =>
      registry.setValues(
        api,
        { external_id: 'ext:test:ata:a' },
        change('ext:test:ata:a:room-temperature'),
      ),
    /not writable/,
  );
  await assert.rejects(
    () =>
      registry.setValues(api, { external_id: 'ext:test:atw:p' }, change('ext:test:atw:p:power')),
    /not writable/,
  );
  assert.equal(api.calls.setAta.length + api.calls.setAtw.length, 0);
});

test('invalidate forces the next read to hit MELCloud Home', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')] });

  await registry.buildDiscoveredDevices(api);
  await registry.buildDiscoveredDevices(api);
  assert.equal(api.calls.listAta, 1);

  registry.invalidate();
  await registry.buildDiscoveredDevices(api);
  assert.equal(api.calls.listAta, 2);
});
