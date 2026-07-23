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

Air-to-water (heat pumps) and ERV (ventilation) units are ignored for now.

## Installation

From Gladys: **Integrations → Install an integration**, then find **MELCloud
Home** in the catalog. Open its configuration, enter the **email** and
**password** of your MELCloud Home account, and save. Use the **Test the
connection** button to check your credentials, then run a device discovery.

## How it works

- **Authentication**: a headless OAuth 2.0 Authorization Code + PKCE flow
  (Pushed Authorization Request → AWS Cognito hosted login → IdentityServer
  callback → token). The refresh token is stored (encrypted) so the session
  survives restarts; it is refreshed automatically.
- **State**: read from `GET /context` (polled at the configured interval).
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
