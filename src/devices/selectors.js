// -----------------------------------------------------------------------------
// Explicit, collision-proof device / feature selectors.
//
// A Gladys `selector` (on a device and on each device-feature) is UNIQUE across
// the whole instance. Published without one, Gladys derives it from the name
// ("Power" -> "power"), which collides with any other device/integration
// exposing something of the same name. Basing it on the already-unique
// external_id (Gladys slugifies it) keeps it globally unique.
// -----------------------------------------------------------------------------

/**
 * Turn an external_id into a selector base (drop the mandatory `ext:` prefix;
 * Gladys slugifies the rest, e.g. `melcloud-home:ata:<id>:power`).
 * @param {string} externalId the external_id
 * @returns {string} the selector base
 */
function selectorFromExternalId(externalId) {
  return externalId.replace(/^ext:/, '');
}

/**
 * Attach explicit, collision-proof selectors to a device and its features.
 * @param {object} device Gladys discovered device (with external_id + features)
 * @returns {object} the device with selectors set
 */
export function withSelectors(device) {
  return {
    ...device,
    selector: selectorFromExternalId(device.external_id),
    features: (device.features || []).map((feature) => ({
      ...feature,
      selector: selectorFromExternalId(feature.external_id),
    })),
  };
}
