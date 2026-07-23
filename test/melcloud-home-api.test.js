import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MELCloudHomeApi, API_ENDPOINT } from '../src/melcloud-home-api.js';

const CONTEXT = {
  buildings: [{ id: 'b1', airToAirUnits: [{ id: 'u1' }, { id: 'u2' }] }],
  guestBuildings: [{ id: 'b2', airToAirUnits: [{ id: 'u3' }] }],
};

test('storeTokens stores tokens, persists the refresh token and computes expiry', async () => {
  let persisted = null;
  const api = new MELCloudHomeApi({
    persistRefreshToken: (t) => {
      persisted = t;
    },
    now: () => 1_000_000,
  });
  await api.storeTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
  assert.equal(api.accessToken, 'a');
  assert.equal(api.refreshToken, 'r');
  assert.equal(persisted, 'r');
  assert.equal(api.tokenExpiresAt, 1_000_000 + (3600 - 60) * 1000);
});

test('getAccessToken returns the cached token while valid', async () => {
  let refreshCalls = 0;
  const api = new MELCloudHomeApi({
    oauthModule: {
      refresh: async () => {
        refreshCalls += 1;
        return {};
      },
    },
    now: () => 0,
  });
  api.accessToken = 'cached';
  api.tokenExpiresAt = 10_000;
  assert.equal(await api.getAccessToken(), 'cached');
  assert.equal(refreshCalls, 0);
});

test('getAccessToken refreshes with the refresh token', async () => {
  const api = new MELCloudHomeApi({
    refreshToken: 'r',
    oauthModule: { refresh: async () => ({ access_token: 'fresh', refresh_token: 'r2' }) },
    now: () => 0,
  });
  assert.equal(await api.getAccessToken(), 'fresh');
});

test('getAccessToken falls back to a full login when refresh fails', async () => {
  let loggedIn = false;
  const api = new MELCloudHomeApi({
    email: 'a',
    password: 'b',
    refreshToken: 'bad',
    oauthModule: {
      refresh: async () => {
        throw new Error('expired');
      },
      login: async () => {
        loggedIn = true;
        return { access_token: 'via-login' };
      },
    },
    now: () => 0,
  });
  assert.equal(await api.getAccessToken(), 'via-login');
  assert.ok(loggedIn);
});

test('getAccessToken throws without credentials or refresh token', async () => {
  const api = new MELCloudHomeApi({ oauthModule: {}, now: () => 0 });
  await assert.rejects(() => api.getAccessToken(), /missing credentials/);
});

test('listAtaUnits flattens units from buildings and guest buildings', async () => {
  const api = new MELCloudHomeApi({
    now: () => 0,
    httpClient: { get: async () => ({ data: CONTEXT }) },
  });
  api.accessToken = 'a';
  api.tokenExpiresAt = 10_000;
  const units = await api.listAtaUnits();
  assert.deepEqual(units, [
    { id: 'u1', buildingId: 'b1' },
    { id: 'u2', buildingId: 'b1' },
    { id: 'u3', buildingId: 'b2' },
  ]);
});

test('setAtaUnit sends a PUT with the payload and auth header', async () => {
  const calls = [];
  const api = new MELCloudHomeApi({
    now: () => 0,
    httpClient: {
      put: async (url, payload, options) => {
        calls.push({ url, payload, options });
      },
    },
  });
  api.accessToken = 'token';
  api.tokenExpiresAt = 10_000;
  await api.setAtaUnit('u1', { power: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_ENDPOINT}/monitor/ataunit/u1`);
  assert.deepEqual(calls[0].payload, { power: false });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
});
