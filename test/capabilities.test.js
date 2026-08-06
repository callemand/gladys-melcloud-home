import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCapabilities,
  compareVersions,
  DEFAULT_CAPABILITIES,
  SWING_MIN_GLADYS_VERSION,
} from '../src/capabilities.js';

test('compareVersions orders versions numerically, not lexically', () => {
  assert.ok(compareVersions('4.84.2', '4.84.1') > 0);
  assert.ok(compareVersions('4.84.1', '4.84.2') < 0);
  assert.equal(compareVersions('4.84.2', '4.84.2'), 0);
  // The trap a string compare falls into.
  assert.ok(compareVersions('4.84.10', '4.84.9') > 0);
  assert.ok(compareVersions('4.100.0', '4.84.2') > 0);
});

test('compareVersions tolerates missing parts and pre-release suffixes', () => {
  assert.equal(compareVersions('4.84', '4.84.0'), 0);
  assert.equal(compareVersions('4.84.2-beta.1', '4.84.2'), 0);
  assert.ok(compareVersions('', '4.84.2') < 0);
});

test('swing is enabled from the Gladys version that introduced it', () => {
  // Verified against the Gladys tags: absent in 4.84.1, present in 4.84.2.
  assert.equal(buildCapabilities('4.84.1').swing, false);
  assert.equal(buildCapabilities(SWING_MIN_GLADYS_VERSION).swing, true);
  assert.equal(buildCapabilities('4.85.0').swing, true);
  assert.equal(buildCapabilities('4.62.0').swing, false);
});

test('an unknown version is treated as too old', () => {
  // Publishing an unsupported feature type costs the whole discovery;
  // omitting it costs two controls.
  assert.equal(buildCapabilities(null).swing, false);
  assert.equal(buildCapabilities(undefined).swing, false);
  assert.equal(buildCapabilities('').swing, false);
  assert.equal(DEFAULT_CAPABILITIES.swing, false);
});
