# MELCloud Home — Gladys Assistant integration

External [Gladys Assistant](https://gladysassistant.com) integration to control
**Mitsubishi Electric air conditioners** through the **MELCloud Home** cloud
(`melcloudhome.com`).

MELCloud Home is the new Mitsubishi Electric platform, **separate** from the
legacy MELCloud (`app.melcloud.com`): accounts are not interoperable and the API
is different (OAuth 2.0 + PKCE, JSON backend-for-frontend). This integration
targets MELCloud Home accounts.

## Features

Air-to-air units (air conditioners) are exposed with:

- **Power** — on / off
- **Mode** — heat / cool / dry / fan / auto
- **Target temperature** — set point
- **Room temperature** — read-only
- **Vertical swing** and **Horizontal swing** — vane position, on the units that
  have vanes. Requires Gladys 4.84.2+ (the version that introduced the air
  conditioning swing feature types); on older versions the two controls are
  simply not published.

Air-to-water units (Ecodan heat pumps) are supported too: power, zone-1 set
point and room temperature, hot water tank set point, tank temperature, forced
hot water and outdoor temperature. ERV (ventilation) units are ignored for now.

## Installation

From Gladys: **Integrations → Install an integration**, then find **MELCloud
Home** in the catalog. Open its configuration, enter the **email** and
**password** of your MELCloud Home account, and save. The connection status is
shown on that screen, and your units are published to the Discovery screen as
soon as the login succeeds.

## How it works

- **Authentication**: a headless OAuth 2.0 Authorization Code + PKCE flow
  (Pushed Authorization Request → AWS Cognito hosted login → IdentityServer
  callback → token). The refresh token is stored (encrypted) so the session
  survives restarts; it is refreshed automatically.
- **State**: read from `GET /context` (polled every minute). One call returns
  the whole account, so the listings are cached for a few seconds: the burst of
  polls Gladys fires for each device in the same tick collapses into a single
  request.
- **Commands**: sent as a full object to `PUT /monitor/ataunit/{id}`; a single
  change is overlaid on the unit's current state so the other attributes are
  preserved.

## Development

```bash
npm install
npm run lint
npm test          # node --test
npm start         # requires GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
```

Built with the official
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and the
[JS integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0
