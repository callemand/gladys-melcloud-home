import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PENDING_TTL, createPendingStates } from '../src/pendingStates.js';

const states = (entries) => new Map(Object.entries(entries));

test('a commanded value wins while MELCloud still reports the previous one', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set('temp', 22, 21);
  // The unit is off: /context lags and still says 21, over and over.
  assert.equal(pending.overlay(states({ temp: 21 })).get('temp'), 22);
  assert.equal(pending.overlay(states({ temp: 21 })).get('temp'), 22);
});

test('a commanded value is forgotten once MELCloud reports it', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set('temp', 22, 21);
  assert.equal(pending.overlay(states({ temp: 22 })).get('temp'), 22);
  // Forgotten: a later 21 is a real change, shown as it is.
  assert.equal(pending.overlay(states({ temp: 21 })).get('temp'), 21);
});

test('a change made elsewhere wins over a commanded value', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set('temp', 22, 21);
  // Set to 19 from the phone app before MELCloud reported our 22.
  assert.equal(pending.overlay(states({ temp: 19 })).get('temp'), 19);
  assert.equal(pending.overlay(states({ temp: 21 })).get('temp'), 21);
});

test('a commanded value expires', () => {
  let now = 0;
  const pending = createPendingStates({ now: () => now });
  pending.set('temp', 22, 21);
  now = PENDING_TTL - 1;
  assert.equal(pending.overlay(states({ temp: 21 })).get('temp'), 22);
  now = PENDING_TTL;
  assert.equal(pending.overlay(states({ temp: 21 })).get('temp'), 21);
});

test('the overlay only touches the features it is given', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set('unit-a:temp', 22, 21);
  // Another unit's states: nothing added, and the entry is kept for unit A.
  assert.deepEqual([...pending.overlay(states({ 'unit-b:temp': 18 }))], [['unit-b:temp', 18]]);
  assert.equal(pending.overlay(states({ 'unit-a:temp': 21 })).get('unit-a:temp'), 22);
});

test('apply returns the published states with the commanded values', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set('power', 0, 1);
  const read = [
    { device_feature_external_id: 'power', state: 1 },
    { device_feature_external_id: 'room', state: 23.5 },
  ];
  assert.deepEqual(pending.apply(read), [
    { device_feature_external_id: 'power', state: 0 },
    { device_feature_external_id: 'room', state: 23.5 },
  ]);
  // The read itself is left as it was.
  assert.equal(read[0].state, 1);
});
