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

test('the credentials fields are required and the password is a secret', () => {
  assert.equal(field('email').required, true);
  assert.equal(field('password').type, 'secret');
  assert.equal(field('password').required, true);
});
