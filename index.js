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
import {
  buildDevice,
  readStates,
  buildSetPayload,
  findUnitByExternalId,
} from './src/devices/airToAir.js';

const gladys = new GladysIntegration();

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
gladys.onScanRequest(async () => {
  if (!api) {
    throw new Error('MELCloud Home is not configured');
  }
  const units = await api.listAtaUnits();
  logger.info(`Discovered ${units.length} MELCloud Home air conditioner(s)`);
  await gladys.publishDiscoveredDevices(units.map((unit) => buildDevice(gladys, unit, config)));
});

// --- Command -----------------------------------------------------------------
gladys.onSetValue(async (device, feature, value) => {
  if (!api) {
    throw new Error('MELCloud Home is not configured');
  }
  const units = await api.listAtaUnits();
  const unit = findUnitByExternalId(gladys, units, device.external_id);
  if (!unit) {
    throw new Error(`MELCloud Home unit not found for ${device.external_id}`);
  }
  const payload = buildSetPayload(gladys, unit, feature.external_id, value);
  if (!payload) {
    throw new Error(`MELCloud Home feature is not writable: ${feature.external_id}`);
  }
  await api.setAtaUnit(unit.id, payload);
  await gladys.publishState(feature.external_id, value);
});

// --- Polling -----------------------------------------------------------------
gladys.onPoll(async (device) => {
  if (!api) {
    return;
  }
  const units = await api.listAtaUnits();
  const unit = findUnitByExternalId(gladys, units, device.external_id);
  if (!unit) {
    return;
  }
  await gladys.publishStates(readStates(gladys, unit));
});

// --- Config change -----------------------------------------------------------
gladys.onConfigUpdated(async () => {
  await initApi();
});

// --- Manifest action: test the connection ------------------------------------
gladys.onAction('test_connection', async () => {
  try {
    const testApi = new MELCloudHomeApi({ email: config.email, password: config.password });
    const units = await testApi.listAtaUnits();
    return {
      en: `Connection successful: ${units.length} air conditioner(s) found.`,
      fr: `Connexion réussie : ${units.length} climatisation(s) trouvée(s).`,
    };
  } catch (e) {
    return {
      en: `Connection failed: ${e.message}`,
      fr: `Échec de la connexion : ${e.message}`,
    };
  }
});

gladys.handleShutdown();

await gladys.connect();
await initApi();
