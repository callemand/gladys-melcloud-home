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

test('compareVersions handles the leading "v" that GET /status reports', () => {
  // Gladys answers "v4.84.4", not "4.84.4". Missing this made parseInt('v4')
  // NaN -> 0, so a 4.84.4 instance compared as 0.84.4 and lost the vanes.
  assert.equal(compareVersions('v4.84.4', '4.84.4'), 0);
  assert.ok(compareVersions('v4.84.4', '4.84.2') > 0);
  assert.ok(compareVersions('v4.84.1', '4.84.2') < 0);
  assert.equal(compareVersions('V4.84.2', '4.84.2'), 0);
  assert.equal(compareVersions(' v4.84.2 ', '4.84.2'), 0);
});

test('compareVersions tolerates missing parts and pre-release suffixes', () => {
  assert.equal(compareVersions('4.84', '4.84.0'), 0);
  assert.equal(compareVersions('4.84.2-beta.1', '4.84.2'), 0);
  assert.ok(compareVersions('', '4.84.2') < 0);
});

test('fan speed follows the same version gate as swing', () => {
  // Both feature types landed in 4.84.2, verified against the Gladys tags.
  assert.equal(buildCapabilities('v4.84.1').fanSpeed, false);
  assert.equal(buildCapabilities('v4.84.2').fanSpeed, true);
  assert.equal(buildCapabilities(null).fanSpeed, false);
});

test('swing is enabled from the Gladys version that introduced it', () => {
  // Verified against the Gladys tags: absent in 4.84.1, present in 4.84.2.
  assert.equal(buildCapabilities('4.84.1').swing, false);
  // The shape Gladys actually reports.
  assert.equal(buildCapabilities('v4.84.4').swing, true);
  assert.equal(buildCapabilities('v4.84.1').swing, false);
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
