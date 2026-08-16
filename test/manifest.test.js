import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url)),
);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

const keys = manifest.config_schema.map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

test('the manifest version matches package.json and the docker image tag', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${pkg.version}`));
});

test('the config schema only asks for the credentials', () => {
  assert.deepEqual(keys, ['intro', 'email', 'password']);
});

test('the refresh interval is not exposed', () => {
  // Gladys stores poll_frequency in an ENUM of milliseconds and rejects the
  // whole discovery payload otherwise: the interval is hardcoded to a value it
  // accepts (src/config.js) rather than left to the user.
  assert.equal(field('poll_frequency'), undefined);
});

test('the manifest declares no action', () => {
  assert.equal(manifest.actions, undefined);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  // The vocabulary is the store validator's business; what this pins is the
  // coupling rule: older cores reject unknown manifest fields, so a manifest
  // declaring `categories` must not claim compatibility below 4.86.0.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  const [, major, minor] = minVersion.map(Number);
  assert.ok(
    major > 4 || (major === 4 && minor >= 86),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('the credentials fields are required and the password is a secret', () => {
  assert.equal(field('email').required, true);
  assert.equal(field('password').type, 'secret');
  assert.equal(field('password').required, true);
});
