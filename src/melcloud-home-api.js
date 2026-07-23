// -----------------------------------------------------------------------------
// MELCloud Home API client.
//
// Wraps the OAuth token lifecycle and the backend-for-frontend (BFF) calls:
//   - GET  /context               -> buildings + air-to-air / air-to-water units
//   - PUT  /monitor/ataunit/{id}   -> command an air-to-air unit
//
// Only air-to-air units (air conditioners) are exposed for now.
// -----------------------------------------------------------------------------

import axios from 'axios';
import * as oauth from './oauth.js';

export const API_ENDPOINT = 'https://mobile.bff.melcloudhome.com';

const TOKEN_REFRESH_BUFFER_SECONDS = 60;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export class MELCloudHomeApi {
  /**
   * @param {object} options - Client options.
   * @param {string} options.email - Account email.
   * @param {string} options.password - Account password.
   * @param {string|null} [options.refreshToken] - Stored refresh token, if any.
   * @param {Function} [options.persistRefreshToken] - Called with a new refresh token to persist it.
   * @param {object} [options.now] - Injectable clock (for tests), defaults to Date.now.
   */
  constructor({
    email,
    password,
    refreshToken = null,
    persistRefreshToken = null,
    now = Date.now,
    oauthModule = oauth,
    httpClient = null,
  } = {}) {
    this.email = email;
    this.password = password;
    this.refreshToken = refreshToken;
    this.persistRefreshToken = persistRefreshToken;
    this.now = now;
    this.oauth = oauthModule;
    this.accessToken = null;
    this.tokenExpiresAt = null;
    this.client = httpClient || axios.create({ timeout: 15000 });
  }

  /**
   * Store a token response and persist the refresh token.
   * @param {object} tokens - Token response.
   * @returns {Promise<void>} Nothing.
   */
  async storeTokens(tokens) {
    this.accessToken = tokens.access_token;
    if (tokens.refresh_token) {
      this.refreshToken = tokens.refresh_token;
      if (this.persistRefreshToken) {
        await this.persistRefreshToken(tokens.refresh_token);
      }
    }
    const expiresIn = tokens.expires_in || DEFAULT_EXPIRES_IN_SECONDS;
    this.tokenExpiresAt = this.now() + (expiresIn - TOKEN_REFRESH_BUFFER_SECONDS) * 1000;
  }

  /**
   * Ensure a valid access token, logging in or refreshing as needed.
   * @returns {Promise<string>} A valid access token.
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiresAt && this.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    if (this.refreshToken) {
      try {
        await this.storeTokens(await this.oauth.refresh(this.refreshToken));
        return this.accessToken;
      } catch {
        // Refresh token expired/revoked: fall back to a full login below.
        this.refreshToken = null;
      }
    }
    if (!this.email || !this.password) {
      throw new Error('MELCloud Home: missing credentials.');
    }
    await this.storeTokens(await this.oauth.login(this.email, this.password));
    return this.accessToken;
  }

  /**
   * Fetch the raw /context payload.
   * @returns {Promise<object>} The context.
   */
  async getContext() {
    const accessToken = await this.getAccessToken();
    const { data } = await this.client.get(`${API_ENDPOINT}/context`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data;
  }

  /**
   * List all air-to-air units, each annotated with its buildingId.
   * @returns {Promise<Array>} Air-to-air units.
   */
  async listAtaUnits() {
    const context = await this.getContext();
    const buildings = [...(context.buildings || []), ...(context.guestBuildings || [])];
    const units = [];
    buildings.forEach((building) => {
      (building.airToAirUnits || []).forEach((unit) => {
        units.push({ ...unit, buildingId: building.id });
      });
    });
    return units;
  }

  /**
   * Send a full command payload to an air-to-air unit.
   * @param {string} unitId - The unit id.
   * @param {object} payload - The full command payload.
   * @returns {Promise<void>} Nothing.
   */
  async setAtaUnit(unitId, payload) {
    const accessToken = await this.getAccessToken();
    await this.client.put(`${API_ENDPOINT}/monitor/ataunit/${unitId}`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }
}
