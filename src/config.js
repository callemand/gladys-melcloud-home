// -----------------------------------------------------------------------------
// Integration configuration.
//
// Values are filled in by the user from the `config_schema` declared in
// `gladys-assistant-integration.json`. The SDK fetches them (`gladys.getConfig()`)
// and notifies changes through `gladys.onConfigUpdated()`.
//
// `melcloud_refresh_token` is NOT in the config_schema: it is written back by the
// integration itself (via `gladys.setConfig`) so the OAuth session survives a
// restart without asking the user to log in again.
// -----------------------------------------------------------------------------

// Not configurable: Gladys does not accept an arbitrary polling interval
// (`t_device.poll_frequency` is an ENUM over the core DEVICE_POLL_FREQUENCIES,
// in MILLISECONDS), and a device carrying anything else is rejected by
// `POST /discovered_device` with a 400. Every minute is the slowest value the
// enum offers and is plenty for a cloud API.
export const POLL_FREQUENCY = 60000;

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  melcloud_refresh_token: null,
};

/**
 * Merge the user config with the defaults and coerce types.
 * @param {Record<string, unknown>} raw - Config returned by the SDK.
 * @returns {object} Normalized config.
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    email: (raw.email ?? '').toString().trim(),
    password: (raw.password ?? '').toString(),
    melcloud_refresh_token: raw.melcloud_refresh_token ?? null,
  };
}
