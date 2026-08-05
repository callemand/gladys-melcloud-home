import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeConfig,
  normalizePollFrequency,
  DEFAULT_CONFIG,
  DEFAULT_POLL_FREQUENCY,
  POLL_FREQUENCIES_LIST,
} from '../src/config.js';

test('normalizeConfig returns defaults for an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig trims email and coerces types', () => {
  const config = normalizeConfig({
    email: '  john@doe.com  ',
    password: 'secret',
    poll_frequency: '30000',
    melcloud_refresh_token: 'rt',
  });
  assert.equal(config.email, 'john@doe.com');
  assert.equal(config.password, 'secret');
  assert.equal(config.poll_frequency, 30000);
  assert.equal(config.melcloud_refresh_token, 'rt');
});

test('normalizeConfig falls back to the default poll frequency', () => {
  assert.equal(normalizeConfig({ email: 'a' }).poll_frequency, DEFAULT_CONFIG.poll_frequency);
});

test('the default poll frequency is one Gladys accepts', () => {
  assert.ok(POLL_FREQUENCIES_LIST.includes(DEFAULT_POLL_FREQUENCY));
});

test('normalizePollFrequency keeps the allowed millisecond values', () => {
  POLL_FREQUENCIES_LIST.forEach((frequency) => {
    assert.equal(normalizePollFrequency(frequency), frequency);
    assert.equal(normalizePollFrequency(String(frequency)), frequency);
  });
});

test('normalizePollFrequency upgrades a legacy value stored in seconds', () => {
  // v1.1.1 and earlier stored seconds, which Gladys rejects (its ENUM is in ms).
  assert.equal(normalizePollFrequency(60), 60000);
  assert.equal(normalizePollFrequency(30), 30000);
  assert.equal(normalizePollFrequency('10'), 10000);
});

test('normalizePollFrequency rejects anything Gladys would refuse', () => {
  [120, 3600, 0, -1, 'abc', null, undefined, {}].forEach((value) => {
    const frequency = normalizePollFrequency(value);
    assert.ok(
      POLL_FREQUENCIES_LIST.includes(frequency),
      `${JSON.stringify(value)} -> ${frequency} is an allowed frequency`,
    );
  });
});
