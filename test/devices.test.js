import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeGladys } from './helpers/fakeGladys.js';
import { createDeviceRegistry, DEVICE_BLUEPRINTS } from '../src/devices/index.js';
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
  const registry = createDeviceRegistry({ gladys, cache: createUnitCache(cacheOptions) });
  return { gladys, api, registry };
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

test('invalidate forces the next read to hit MELCloud Home', async () => {
  const { api, registry } = setup({ ata: [ataUnit('a')] });

  await registry.buildDiscoveredDevices(api);
  await registry.buildDiscoveredDevices(api);
  assert.equal(api.calls.listAta, 1);

  registry.invalidate();
  await registry.buildDiscoveredDevices(api);
  assert.equal(api.calls.listAta, 2);
});
