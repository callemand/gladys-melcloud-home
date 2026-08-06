// What the Gladys instance on the other end supports.
//
// Gladys validates feature types against its own list: an unknown one fails
// `POST /discovered_device` with a 400 and takes the whole discovery with it,
// silently (the SDK swallows scan-handler errors). Gating per version beats
// raising the manifest's `gladys_version`, which would lock older instances out
// of the integration entirely.

// First Gladys version exposing DEVICE_FEATURE_TYPES.AIR_CONDITIONING.SWING_*.
export const SWING_MIN_GLADYS_VERSION = '4.84.2';

/**
 * Compare two dotted version strings.
 * @param {string} a - Left version.
 * @param {string} b - Right version.
 * @returns {number} Negative when a < b, 0 when equal, positive when a > b.
 */
export function compareVersions(a, b) {
  // Only the numeric core is compared: a pre-release suffix ("4.84.2-beta.1")
  // is dropped, so a beta counts as having the type it introduced.
  //
  // The leading "v" matters: `GET /status` reports "v4.84.4". Unstripped,
  // `parseInt('v4')` is NaN, the fallback turns it into 0, and the version
  // reads as 0.84.4 — older than anything.
  const parse = (version) =>
    String(version ?? '')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Build the capability flags for a given Gladys version.
 * @param {string|null} gladysVersion - The version reported by `GET /status`.
 * @returns {{swing: boolean}} The capabilities.
 */
export function buildCapabilities(gladysVersion) {
  return {
    // An unknown version is treated as "too old": publishing an unsupported
    // feature type costs the whole discovery, omitting it costs two controls.
    swing: Boolean(gladysVersion) && compareVersions(gladysVersion, SWING_MIN_GLADYS_VERSION) >= 0,
  };
}

export const DEFAULT_CAPABILITIES = buildCapabilities(null);
