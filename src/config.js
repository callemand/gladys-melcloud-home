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

// Gladys does NOT accept an arbitrary polling interval: `t_device.poll_frequency`
// is an ENUM over these exact values, in MILLISECONDS (core
// DEVICE_POLL_FREQUENCIES). A discovered device carrying anything else is
// rejected by `POST /discovered_device` with a 400, and — because the SDK
// swallows the errors of the scan handler — the whole discovery silently
// disappears from the Discovery screen. Only the intervals that make sense for
// a cloud API are exposed.
export const POLL_FREQUENCIES = {
  EVERY_MINUTE: 60000,
  EVERY_30_SECONDS: 30000,
  EVERY_15_SECONDS: 15000,
  EVERY_10_SECONDS: 10000,
};

export const POLL_FREQUENCIES_LIST = Object.values(POLL_FREQUENCIES);

export const DEFAULT_POLL_FREQUENCY = POLL_FREQUENCIES.EVERY_MINUTE;

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  poll_frequency: DEFAULT_POLL_FREQUENCY, // milliseconds
  melcloud_refresh_token: null,
};

/**
 * Coerce a stored poll frequency to a value Gladys accepts.
 *
 * Up to v1.1.1 the config held SECONDS (the manifest asked for a free number),
 * so an existing installation carries e.g. `60`: such a value is upgraded to
 * its millisecond equivalent when that lands on an allowed frequency, and
 * falls back to the default otherwise.
 * @param {unknown} value - The raw configured value.
 * @returns {number} An allowed poll frequency, in milliseconds.
 */
export function normalizePollFrequency(value) {
  const parsed = Number(value);
  if (POLL_FREQUENCIES_LIST.includes(parsed)) {
    return parsed;
  }
  if (POLL_FREQUENCIES_LIST.includes(parsed * 1000)) {
    return parsed * 1000;
  }
  return DEFAULT_POLL_FREQUENCY;
}

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
    poll_frequency: normalizePollFrequency(raw.poll_frequency ?? DEFAULT_POLL_FREQUENCY),
    melcloud_refresh_token: raw.melcloud_refresh_token ?? null,
  };
}
