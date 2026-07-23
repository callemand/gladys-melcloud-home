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

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  poll_frequency: 60, // seconds
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
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
    melcloud_refresh_token: raw.melcloud_refresh_token ?? null,
  };
}
