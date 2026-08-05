import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig, DEFAULT_CONFIG, POLL_FREQUENCY } from '../src/config.js';

// Gladys stores poll_frequency in an ENUM of milliseconds (core
// DEVICE_POLL_FREQUENCIES): a device published with anything else is rejected
// by POST /discovered_device with a 400.
const GLADYS_POLL_FREQUENCIES = [60000, 30000, 15000, 10000, 2000, 1000];

test('normalizeConfig returns defaults for an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig trims email and coerces types', () => {
  const config = normalizeConfig({
    email: '  john@doe.com  ',
    password: 'secret',
    melcloud_refresh_token: 'rt',
  });
  assert.equal(config.email, 'john@doe.com');
  assert.equal(config.password, 'secret');
  assert.equal(config.melcloud_refresh_token, 'rt');
});

test('the poll frequency is not part of the config: it is not configurable', () => {
  assert.ok(!('poll_frequency' in DEFAULT_CONFIG));
});

test('the hardcoded poll frequency is one Gladys accepts', () => {
  assert.ok(GLADYS_POLL_FREQUENCIES.includes(POLL_FREQUENCY));
});
