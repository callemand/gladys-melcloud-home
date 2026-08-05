import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createUnitCache, DEFAULT_TTL } from '../src/devices/unitCache.js';

// Controllable clock: the cache must be testable without waiting on real time.
const createClock = () => {
  let value = 0;
  return { now: () => value, advance: (ms) => (value += ms) };
};

test('the default TTL is well under the one-minute poll cycle', () => {
  assert.ok(DEFAULT_TTL > 0 && DEFAULT_TTL < 60000);
});

test('a burst of concurrent reads shares a single load', async () => {
  const clock = createClock();
  const cache = createUnitCache({ now: clock.now });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return ['unit'];
  };

  // What the Gladys scheduler does: four devices, same tick, same family.
  const results = await Promise.all([
    cache.get('ata', loader),
    cache.get('ata', loader),
    cache.get('ata', loader),
    cache.get('ata', loader),
  ]);

  assert.equal(calls, 1);
  results.forEach((result) => assert.deepEqual(result, ['unit']));
});

test('a read within the TTL is served from the cache, and refreshed after it', async () => {
  const clock = createClock();
  const cache = createUnitCache({ ttl: 1000, now: clock.now });
  let calls = 0;
  const loader = async () => ++calls;

  assert.equal(await cache.get('ata', loader), 1);
  clock.advance(999);
  assert.equal(await cache.get('ata', loader), 1);
  clock.advance(2);
  assert.equal(await cache.get('ata', loader), 2);
});

test('families do not share an entry', async () => {
  const cache = createUnitCache();
  assert.equal(await cache.get('ata', async () => 'ac'), 'ac');
  assert.equal(await cache.get('atw', async () => 'pump'), 'pump');
  assert.equal(await cache.get('ata', async () => 'other'), 'ac');
});

test('invalidate drops one family or all of them', async () => {
  const cache = createUnitCache();
  await cache.get('ata', async () => 'first');
  await cache.get('atw', async () => 'first');

  cache.invalidate('ata');
  assert.equal(await cache.get('ata', async () => 'second'), 'second');
  assert.equal(await cache.get('atw', async () => 'second'), 'first');

  cache.invalidate();
  assert.equal(await cache.get('atw', async () => 'third'), 'third');
});

test('a failed load is not cached and reaches the caller', async () => {
  const cache = createUnitCache();
  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw new Error('boom');
  };

  await assert.rejects(() => cache.get('ata', failing), /boom/);
  // The next caller must retry rather than replay the failure forever.
  assert.equal(await cache.get('ata', async () => 'ok'), 'ok');
  assert.equal(calls, 1);
});
