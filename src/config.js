// Integration configuration, from the manifest `config_schema`.
//
// `melcloud_refresh_token` is NOT in that schema: the integration writes it
// back itself so the OAuth session survives a restart.

// Not configurable: `t_device.poll_frequency` is an ENUM over the core
// DEVICE_POLL_FREQUENCIES, in milliseconds, and anything else gets the device
// rejected with a 400. This is the slowest value it offers.
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
