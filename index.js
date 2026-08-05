// -----------------------------------------------------------------------------
// Entry point of the MELCloud Home external integration.
//
// Wires the Gladys SDK to the MELCloud Home API:
//   - onScanRequest -> list air-to-air units and publish them as devices
//   - onSetValue    -> send a command to a unit
//   - onPoll        -> refresh a unit's state
//   - onConfigUpdated -> re-authenticate with the new credentials
//   - test_connection action -> verify the credentials on demand
//
// Env vars provided by the Gladys supervisor (read automatically by the SDK):
//   GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { MELCloudHomeApi } from './src/melcloud-home-api.js';
import * as airToAir from './src/devices/airToAir.js';
import * as airToWater from './src/devices/airToWater.js';

const gladys = new GladysIntegration();

// Supported device families. Each entry pairs a device module (discovery/state/
// command mapping) with the API calls that list and command that family.
const DEVICE_FAMILIES = [
  {
    module: airToAir,
    label: 'air conditioner',
    list: (client) => client.listAtaUnits(),
    set: (client, unitId, payload) => client.setAtaUnit(unitId, payload),
  },
  {
    module: airToWater,
    label: 'heat pump',
    list: (client) => client.listAtwUnits(),
    set: (client, unitId, payload) => client.setAtwUnit(unitId, payload),
  },
];

/**
 * Resolve the device family, unit and API list for a Gladys device.
 * @param {object} device - The Gladys device (has external_id).
 * @returns {Promise<{family: object, unit: object, units: Array}|null>} Match or null.
 */
async function resolveDevice(device) {
  for (const family of DEVICE_FAMILIES) {
    const units = await family.list(api);
    const unit = family.module.findUnitByExternalId(gladys, units, device.external_id);
    if (unit) {
      return { family, unit, units };
    }
  }
  return null;
}

let config = normalizeConfig();
let api = null;

/**
 * (Re)build the API client from the current config and check the connection.
 * @returns {Promise<void>} Nothing.
 */
async function initApi() {
  config = normalizeConfig(await gladys.getConfig());

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
    logger.info('Connected to MELCloud Home');
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
 * List every unit of every family and publish them as discovered devices.
 *
 * The SDK swallows the errors thrown by its event handlers (they carry no ack),
 * so a rejected publish would leave the Discovery screen empty with nothing in
 * the logs: the failure is logged explicitly here.
 * @returns {Promise<void>} Nothing.
 */
async function publishDevices() {
  if (!api) {
    logger.warn('Skipping discovery: MELCloud Home is not configured');
    return;
  }
  const devices = [];
  for (const family of DEVICE_FAMILIES) {
    const units = await family.list(api);
    logger.info(`Discovered ${units.length} MELCloud Home ${family.label}(s)`);
    units.forEach((unit) => devices.push(family.module.buildDevice(gladys, unit, config)));
  }
  try {
    await gladys.publishDiscoveredDevices(devices);
    logger.info(`Published ${devices.length} discovered device(s) to Gladys`);
  } catch (e) {
    logger.error('Failed to publish the discovered devices to Gladys:', e.message);
    throw e;
  }
}

gladys.onScanRequest(publishDevices);

// --- Command -----------------------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  if (!api) {
    throw new Error('MELCloud Home is not configured');
  }
  const match = await resolveDevice(device);
  if (!match) {
    throw new Error(`MELCloud Home unit not found for ${device.external_id}`);
  }
  const payload = match.family.module.buildSetPayload(
    gladys,
    match.unit,
    feature.external_id,
    value,
  );
  if (!payload) {
    throw new Error(`MELCloud Home feature is not writable: ${feature.external_id}`);
  }
  await match.family.set(api, match.unit.id, payload);
  await gladys.publishState(feature.external_id, value);
});

// --- Polling -----------------------------------------------------------------
gladys.onPoll(async (device) => {
  if (!api) {
    return;
  }
  const match = await resolveDevice(device);
  if (!match) {
    return;
  }
  await gladys.publishStates(match.family.module.readStates(gladys, match.unit));
});

// --- Config change -----------------------------------------------------------
gladys.onConfigUpdated(async () => {
  await initApi();
  // The poll frequency lives on the device itself: re-publish so the change
  // reaches the already-created devices (publishDiscoveredDevices upserts by
  // external_id).
  await publishDevices();
});

// --- Manifest action: test the connection ------------------------------------
gladys.onAction('test_connection', async () => {
  try {
    const testApi = new MELCloudHomeApi({ email: config.email, password: config.password });
    const ata = await testApi.listAtaUnits();
    const atw = await testApi.listAtwUnits();
    const count = ata.length + atw.length;
    return {
      en: `Connection successful: ${count} device(s) found (${ata.length} AC, ${atw.length} heat pump).`,
      fr: `Connexion réussie : ${count} appareil(s) trouvé(s) (${ata.length} clim, ${atw.length} PAC).`,
    };
  } catch (e) {
    return {
      en: `Connection failed: ${e.message}`,
      fr: `Échec de la connexion : ${e.message}`,
    };
  }
});

// --- Connection lifecycle ----------------------------------------------------
// Authenticate and publish the devices as soon as the WebSocket is up (and on
// every reconnection). Publishing here instead of only on `onScanRequest` means
// the devices show up in the Discovery screen without the user having to hit
// "Scan" first.
gladys.on('connected', async () => {
  try {
    await initApi();
    await publishDevices();
  } catch (e) {
    logger.error('MELCloud Home initialization failed:', e.message);
  }
});

gladys.handleShutdown();

await gladys.connect();
