// -----------------------------------------------------------------------------
// MELCloud Home OAuth 2.0 (Authorization Code + PKCE) headless login.
//
// MELCloud Home authenticates through an IdentityServer (auth.melcloudhome.com)
// that federates to an AWS Cognito hosted login page. This module performs the
// whole flow without a browser:
//   PAR -> authorize -> Cognito login form -> submit credentials ->
//   IdentityServer callback (incl. the /Redirect interstitial) ->
//   capture the `melcloudhome://` authorization code -> exchange for tokens.
//
// This flow was validated end-to-end against the live service.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import querystring from 'node:querystring';
import { URL } from 'node:url';
import axios from 'axios';

export const AUTH_ENDPOINT = 'https://auth.melcloudhome.com';

export const OAUTH = {
  CLIENT_ID: 'homemobile',
  // "homemobile:" base64-encoded (client id with an empty secret).
  BASIC_AUTH: 'Basic aG9tZW1vYmlsZTo=',
  REDIRECT_URI: 'melcloudhome://',
  SCOPE: 'openid profile email offline_access IdentityServerApi',
  RESPONSE_TYPE: 'code',
  CODE_CHALLENGE_METHOD: 'S256',
};

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a PKCE code verifier and its S256 challenge.
 * @returns {{codeVerifier: string, codeChallenge: string}} PKCE pair.
 */
export function generatePkce() {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x3D;/g, '=')
    .replace(/&quot;/g, '"');
}

/**
 * Host-scoped cookie jar: cookies from the identity provider and from the
 * authorization server are kept separate.
 * @returns {{update: Function, serialize: Function}} Cookie jar.
 */
export function createCookieJar() {
  const store = {};
  return {
    update(url, setCookieHeaders) {
      if (!setCookieHeaders) {
        return;
      }
      const { host } = new URL(url);
      store[host] = store[host] || {};
      setCookieHeaders.forEach((cookie) => {
        const [pair] = cookie.split(';');
        const index = pair.indexOf('=');
        if (index > 0) {
          store[host][pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
        }
      });
    },
    serialize(url) {
      const { host } = new URL(url);
      const cookies = store[host] || {};
      return Object.keys(cookies)
        .map((name) => `${name}=${cookies[name]}`)
        .join('; ');
    },
  };
}

/**
 * Extract the login form action URL and its inputs from an HTML page.
 * @param {string} html - The login page HTML.
 * @returns {{action: string|null, fields: object}} Parsed form.
 */
export function parseLoginForm(html) {
  const actionMatch = html.match(/<form[^>]*\baction=["']([^"']+)["']/i);
  const action = actionMatch ? decodeHtmlEntities(actionMatch[1]) : null;

  const fields = {};
  const inputRegex = /<input[^>]*>/gi;
  let match = inputRegex.exec(html);
  while (match !== null) {
    const input = match[0];
    const nameMatch = input.match(/\bname=["']([^"']+)["']/i);
    const valueMatch = input.match(/\bvalue=["']([^"']*)["']/i);
    if (nameMatch) {
      fields[nameMatch[1]] = valueMatch ? decodeHtmlEntities(valueMatch[1]) : '';
    }
    match = inputRegex.exec(html);
  }

  return { action, fields };
}

/**
 * Follow the redirect chain from a start URL until the `melcloudhome://`
 * authorization-code redirect is captured, or a terminal HTML page is reached.
 * Handles the Duende IdentityServer `/Redirect?RedirectUri=...` interstitial.
 * @param {object} client - Axios instance (maxRedirects 0).
 * @param {object} jar - Cookie jar.
 * @param {string} startUrl - URL to start from.
 * @returns {Promise<object>} An object with the authorization `code`, or the terminal `html` and `finalUrl`.
 */
export async function followChain(client, jar, startUrl) {
  let url = startUrl;
  for (let i = 0; i < 15; i += 1) {
    if (url.startsWith(OAUTH.REDIRECT_URI)) {
      return { code: new URL(url).searchParams.get('code') };
    }
    const response = await client.get(url, { headers: { Cookie: jar.serialize(url) } });
    jar.update(url, response.headers['set-cookie']);

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      url = new URL(response.headers.location, url).toString();
    } else {
      const redirectUri = new URL(url).searchParams.get('RedirectUri');
      if (redirectUri) {
        url = new URL(redirectUri, url).toString();
      } else {
        return { html: String(response.data), finalUrl: url };
      }
    }
  }
  return {};
}

/**
 * Exchange an authorization code for an access/refresh token pair.
 * @param {string} code - The authorization code.
 * @param {string} codeVerifier - The PKCE code verifier.
 * @returns {Promise<object>} Token response.
 */
export async function exchangeCode(code, codeVerifier) {
  const { data } = await axios.post(
    `${AUTH_ENDPOINT}/connect/token`,
    querystring.stringify({
      grant_type: 'authorization_code',
      client_id: OAUTH.CLIENT_ID,
      code,
      redirect_uri: OAUTH.REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: OAUTH.BASIC_AUTH,
      },
    },
  );
  return data;
}

/**
 * Perform the full headless PKCE login and return tokens.
 * @param {string} email - MELCloud Home account email.
 * @param {string} password - MELCloud Home account password.
 * @returns {Promise<object>} Token response ({ access_token, refresh_token, expires_in }).
 */
export async function login(email, password) {
  const client = axios.create({
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const jar = createCookieJar();
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = base64UrlEncode(crypto.randomBytes(16));

  // Step 1 — Pushed Authorization Request.
  const parUrl = `${AUTH_ENDPOINT}/connect/par`;
  const parResponse = await client.post(
    parUrl,
    querystring.stringify({
      client_id: OAUTH.CLIENT_ID,
      redirect_uri: OAUTH.REDIRECT_URI,
      response_type: OAUTH.RESPONSE_TYPE,
      scope: OAUTH.SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: OAUTH.CODE_CHALLENGE_METHOD,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  jar.update(parUrl, parResponse.headers['set-cookie']);

  // Step 2 — Authorize, follow redirects to the login form.
  const authorizeUrl = `${AUTH_ENDPOINT}/connect/authorize?${querystring.stringify({
    client_id: OAUTH.CLIENT_ID,
    request_uri: parResponse.data.request_uri,
  })}`;
  const loginPage = await followChain(client, jar, authorizeUrl);
  if (!loginPage.html) {
    throw new Error('MELCloud Home: unable to reach the login form.');
  }

  // Step 3 — Submit credentials.
  const { action, fields } = parseLoginForm(loginPage.html);
  if (!action) {
    throw new Error('MELCloud Home: unable to parse the login form.');
  }
  const loginActionUrl = new URL(action, loginPage.finalUrl).toString();
  const loginResponse = await client.post(
    loginActionUrl,
    querystring.stringify({ ...fields, username: email, password }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: jar.serialize(loginActionUrl),
      },
    },
  );
  jar.update(loginActionUrl, loginResponse.headers['set-cookie']);
  if (!loginResponse.headers.location) {
    throw new Error('MELCloud Home: login failed (check your credentials).');
  }

  // Step 4 — Follow the chain to the `melcloudhome://` authorization code.
  const afterLoginUrl = new URL(loginResponse.headers.location, loginActionUrl).toString();
  const { code } = await followChain(client, jar, afterLoginUrl);
  if (!code) {
    throw new Error(
      'MELCloud Home: login failed, no authorization code returned (check your credentials).',
    );
  }

  // Step 5 — Exchange the code for tokens.
  return exchangeCode(code, codeVerifier);
}

/**
 * Refresh an access token using a refresh token.
 * @param {string} refreshToken - The refresh token.
 * @returns {Promise<object>} Token response.
 */
export async function refresh(refreshToken) {
  const { data } = await axios.post(
    `${AUTH_ENDPOINT}/connect/token`,
    querystring.stringify({
      grant_type: 'refresh_token',
      client_id: OAUTH.CLIENT_ID,
      refresh_token: refreshToken,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: OAUTH.BASIC_AUTH,
      },
    },
  );
  return data;
}
