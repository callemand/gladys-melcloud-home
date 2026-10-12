// -----------------------------------------------------------------------------
// Entry point of the MELCloud Home external integration.
//
// Role of this file: wire the SDK to the device registry (src/devices/). It
// holds NO device logic — the mapping between a MELCloud Home unit and a Gladys
// device lives in the device modules, the routing in the registry. This file
// only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. owns the MELCloud Home client and its (re)authentication;
//   3. registers the event handlers BEFORE connect();
//   4. connects and publishes the discovered devices.
//
// Env vars provided by the Gladys supervisor (read automatically by the SDK):
//   GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { MELCloudHomeApi } from './src/melcloud-home-api.js';
import { createDeviceRegistry } from './src/devices/index.js';
import { createRealtimeClient } from './src/realtime.js';
import {
  REMOTE_WIDGET_KEY,
  buildRemoteContent,
  buildRemoteMessageContent,
  createPendingStates,
  planRemoteAction,
} from './src/widgets/remote.js';

const gladys = new GladysIntegration();
const registry = createDeviceRegistry({ gladys });

// Stamped in the connection log so a bug report tells us which build is running
// (package.json is copied into the image, see the Dockerfile).
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();
// The MELCloud Home client, null until the credentials are known and valid.
let api = null;
// Values commanded from the remote control widget, until MELCloud reports them.
const pendingStates = createPendingStates();

/**
 * (Re)build the API client from the current config and check the connection.
 * @returns {Promise<void>} Nothing.
 */
async function initApi() {
  config = normalizeConfig(await gladys.getConfig());
  // The previous account's units must not survive a credentials change.
  registry.invalidate();

  if (!config.email || !config.password) {
    api = null;
    await gladys.setConnectionStatus(false, {
      en: 'Enter your MELCloud Home email and password.',
      fr: 'Renseignez votre email et mot de passe MELCloud Home.',
    });
    return;
  }

  api = new MELCloudHomeApi({
    email: config.email,
    password: config.password,
    refreshToken: config.melcloud_refresh_token,
    persistRefreshToken: (token) => gladys.setConfig({ melcloud_refresh_token: token }),
  });

  try {
    await api.getAccessToken();
    await gladys.setConnectionStatus(true);
    logger.info(`Connected to MELCloud Home (integration v${VERSION})`);
  } catch (e) {
    api = null;
    logger.error('MELCloud Home connection failed:', e.message);
    await gladys.setConnectionStatus(false, {
      en: 'Login failed, please check your credentials.',
      fr: 'Échec de connexion, vérifiez vos identifiants.',
    });
  }
}

// --- Discovery ---------------------------------------------------------------
/**
 * Publish every unit of the account as a discovered device.
 *
 * The SDK swallows the errors thrown by its event handlers (they carry no ack),
 * so a rejected publish would leave the Discovery screen empty with nothing in
 * the logs: the failure is logged explicitly here.
 * @returns {Promise<void>} Nothing.
 */
async function doPublishDevices() {
  if (!api) {
    logger.warn('Skipping discovery: MELCloud Home is not configured');
    return;
  }
  const devices = await registry.buildDiscoveredDevices(api);
  try {
    await gladys.publishDiscoveredDevices(devices);
    logger.info(`Published ${devices.length} discovered device(s) to Gladys`);
  } catch (e) {
    logger.error('Failed to publish the discovered devices to Gladys:', e.message);
    throw e;
  }
}

// Connecting, a config change and a Scan can each ask for a publish at once,
// duplicating the log line and the POST.
let publishInFlight = null;

/**
 * Publish the discovered devices, joining a publish already in flight.
 * @returns {Promise<void>} Nothing.
 */
function publishDevices() {
  if (!publishInFlight) {
    publishInFlight = doPublishDevices().finally(() => {
      publishInFlight = null;
    });
  }
  return publishInFlight;
}

// --- Real time ---------------------------------------------------------------
/**
 * Refresh and publish the state of every created device. Costs one `/context`
 * request in total: the unit cache shares it across the devices.
 * @returns {Promise<void>} Nothing.
 */
async function refreshAllStates() {
  if (!api) {
    return;
  }
  registry.invalidate();
  const devices =
    gladys.devices && gladys.devices.length ? gladys.devices : await gladys.getDevices();
  for (const device of devices) {
    const states = await registry.readStates(api, device);
    if (states) {
      await gladys.publishStates(states);
    }
  }
  refreshWidgets();
}

/**
 * Ask Gladys to re-pull the remote control widgets: their status list is
 * computed here, unlike the temperature tiles that follow the device states.
 * Rate-limited by the core, and a no-op when no widget is open.
 * @returns {void} Nothing.
 */
function refreshWidgets() {
  gladys.requestWidgetRefresh(REMOTE_WIDGET_KEY);
}

const realtime = createRealtimeClient({
  getApi: () => api,
  onUnitsChanged: refreshAllStates,
  logger,
});

// A scan is an explicit user gesture: never answer it from the cache.
gladys.onScanRequest(async () => {
  registry.invalidate();
  await publishDevices();
});

// --- Command -----------------------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  if (!api) {
    // Throw: the SDK sends a success:false acknowledgement to Gladys.
    throw new Error('MELCloud Home is not configured');
  }
  await registry.setValue(api, device, feature, value);
  pendingStates.set(feature.external_id, value);
  await gladys.publishState(feature.external_id, value);
  refreshWidgets();
});

// --- Remote control widget ---------------------------------------------------
/**
 * Find the air conditioner a widget instance is set to.
 * @param {object} settings - The widget instance settings.
 * @returns {Promise<{unit: object}|{reason: string}>} The unit, or why there is none.
 */
async function findWidgetUnit(settings) {
  if (!api) {
    return { reason: 'notConfigured' };
  }
  const match = await registry.findUnit(api, settings.unit);
  if (!match) {
    return { reason: 'notFound' };
  }
  if (match.blueprint.key !== 'ata') {
    return { reason: 'notAnAirConditioner' };
  }
  return { unit: match.unit };
}

gladys.onWidgetGet(REMOTE_WIDGET_KEY, async ({ settings }) => {
  const { unit, reason } = await findWidgetUnit(settings);
  if (!unit) {
    return buildRemoteMessageContent(reason);
  }
  return buildRemoteContent(gladys, unit, { settings, pending: pendingStates });
});

gladys.onWidgetAction(REMOTE_WIDGET_KEY, async (actionKey, params, { settings }) => {
  const { unit, reason } = await findWidgetUnit(settings);
  if (!unit) {
    // Throw: the SDK sends a success:false acknowledgement to Gladys.
    throw new Error(`Remote control unavailable: ${reason}`);
  }
  const { featureExternalId, value } = planRemoteAction(
    gladys,
    unit,
    actionKey,
    params,
    pendingStates,
  );
  await registry.setValue(
    api,
    { external_id: settings.unit },
    { external_id: featureExternalId },
    value,
  );
  pendingStates.set(featureExternalId, value);
  await gladys.publishState(featureExternalId, value);
  // No refresh nudge: after a successful action the core re-pulls the content.
});

// --- Polling -----------------------------------------------------------------
gladys.onPoll(async (device) => {
  if (!api) {
    return;
  }
  const states = await registry.readStates(api, device);
  if (states) {
    await gladys.publishStates(states);
  }
});

// --- Config change -----------------------------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  // Persisting the refresh token is itself a config write and comes back here:
  // re-initializing on it would rebuild the client, refresh, persist again.
  const next = normalizeConfig(newConfig);
  if (next.email === config.email && next.password === config.password) {
    config = next;
    return;
  }
  await initApi();
  // New credentials can expose a different set of units: re-publish so the
  // Discovery screen reflects the account actually connected
  // (publishDiscoveredDevices upserts by external_id).
  await publishDevices();
  // The hash is tied to the account.
  realtime.restart();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK itself logs the WebSocket lifecycle (connections, disconnections,
// reconnection attempts); this handler only runs the integration's own
// (re)initialization. Authenticating and publishing here instead of only on
// `onScanRequest` means the devices show up in the Discovery screen without the
// user having to hit "Scan" first.
gladys.on('connected', async () => {
  try {
    await initApi();
    await publishDevices();
    realtime.start();
  } catch (e) {
    logger.error('MELCloud Home initialization failed:', e.message);
  }
});

// --- Graceful shutdown -------------------------------------------------------
// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  realtime.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info(`Starting the MELCloud Home integration (v${VERSION})...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
