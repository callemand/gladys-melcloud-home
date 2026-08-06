// -----------------------------------------------------------------------------
// What the Gladys instance on the other end actually supports.
//
// Gladys validates every published device feature against ITS OWN list of
// feature types: a type the running version does not know makes
// `POST /discovered_device` fail with a 400 — and since the SDK swallows the
// errors of its event handlers, the whole discovery would silently vanish from
// the Discovery screen (the bug fixed in 1.1.2).
//
// The AC swing types (`swing-vertical`, `swing-horizontal`) and the AC_SWING_*
// vocabulary landed in Gladys 4.84.2 — they are absent from 4.84.1. Rather than
// raising the manifest's `gladys_version` and locking every older instance out
// of the integration entirely, the vane features are published only to the
// versions that can accept them.
// -----------------------------------------------------------------------------

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
  // is dropped, so a beta of the version that introduced a type counts as
  // having it. Gladys ships those to testers, and a rejected feature is a far
  // worse outcome than a feature offered slightly early.
  const parse = (version) =>
    String(version ?? '')
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
