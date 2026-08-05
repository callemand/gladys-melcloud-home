import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_POLL_FREQUENCY, POLL_FREQUENCIES_LIST } from '../src/config.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url)),
);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

test('the manifest version matches package.json and the docker image tag', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${pkg.version}`));
});

test('every declared action has a handler key', () => {
  const keys = manifest.actions.map((action) => action.key);
  assert.deepEqual(keys, ['test_connection']);
});

test('the poll frequency field only offers frequencies Gladys accepts', () => {
  // Gladys stores poll_frequency in an ENUM of milliseconds: a free number
  // field let the user pick a value that made POST /discovered_device fail
  // with a 400, silently emptying the Discovery screen.
  const pollFrequency = field('poll_frequency');
  assert.equal(pollFrequency.type, 'select');
  const values = pollFrequency.options.map((option) => Number(option.value));
  assert.deepEqual(values, POLL_FREQUENCIES_LIST);
  pollFrequency.options.forEach((option) => {
    assert.equal(typeof option.value, 'string', 'select option values must be strings');
    assert.ok(option.label.en && option.label.fr);
  });
  assert.equal(Number(pollFrequency.default), DEFAULT_POLL_FREQUENCY);
  assert.ok(
    values.includes(Number(pollFrequency.default)),
    'the default must be one of the options',
  );
});

test('the credentials fields are required and the password is a secret', () => {
  assert.equal(field('email').required, true);
  assert.equal(field('password').type, 'secret');
  assert.equal(field('password').required, true);
});
