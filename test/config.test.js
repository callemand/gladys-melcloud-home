import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig, DEFAULT_CONFIG } from '../src/config.js';

test('normalizeConfig returns defaults for an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig trims email and coerces types', () => {
  const config = normalizeConfig({
    email: '  john@doe.com  ',
    password: 'secret',
    poll_frequency: '120',
    melcloud_refresh_token: 'rt',
  });
  assert.equal(config.email, 'john@doe.com');
  assert.equal(config.password, 'secret');
  assert.equal(config.poll_frequency, 120);
  assert.equal(config.melcloud_refresh_token, 'rt');
});

test('normalizeConfig falls back to the default poll frequency', () => {
  assert.equal(normalizeConfig({ email: 'a' }).poll_frequency, DEFAULT_CONFIG.poll_frequency);
});
