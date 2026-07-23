import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generatePkce, parseLoginForm, createCookieJar } from '../src/oauth.js';

test('generatePkce produces a verifier and a url-safe challenge', () => {
  const { codeVerifier, codeChallenge } = generatePkce();
  assert.ok(codeVerifier.length > 0);
  assert.ok(codeChallenge.length > 0);
  assert.ok(!codeChallenge.includes('='));
  assert.ok(!codeChallenge.includes('+'));
});

test('parseLoginForm extracts the HTML-decoded action and inputs', () => {
  const html = `
    <form action="/login?x=1&amp;y=2" method="post">
      <input type="hidden" name="_csrf" value="tok" />
      <input name="username" type="text" />
      <input type="submit" value="Go" />
    </form>`;
  const { action, fields } = parseLoginForm(html);
  assert.equal(action, '/login?x=1&y=2');
  assert.equal(fields._csrf, 'tok');
  assert.equal(fields.username, '');
});

test('parseLoginForm returns a null action when there is no form', () => {
  assert.equal(parseLoginForm('<html>no form</html>').action, null);
});

test('createCookieJar scopes cookies per host and ignores malformed ones', () => {
  const jar = createCookieJar();
  jar.update('https://a.example.com/x', undefined);
  jar.update('https://a.example.com/x', ['k=v; Path=/', 'malformed']);
  assert.equal(jar.serialize('https://a.example.com/x'), 'k=v');
  assert.equal(jar.serialize('https://b.example.com/x'), '');
});
