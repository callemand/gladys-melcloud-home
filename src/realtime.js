// -----------------------------------------------------------------------------
// Real-time updates from MELCloud Home, over `wss://ws.melcloudhome.com`.
//
// A frame is a DELTA, not a snapshot: it is treated as a signal to re-read
// `/context`, never applied on its own.
//
// The socket is only an accelerator — polling stays on — so every failure here
// degrades to the one-minute refresh and nothing in this module throws.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';

export const WS_ENDPOINT = 'wss://ws.melcloudhome.com';

export const RECONNECT_INITIAL_DELAY = 1000;
// Capped at the poll interval: past that, polling already covers the state.
export const RECONNECT_MAX_DELAY = 60000;

// One command emits one frame per changed setting; this turns the burst into a
// single refresh.
export const REFRESH_DEBOUNCE = 500;

/**
 * Extract the units named by a raw WebSocket payload. Tolerates a single frame
 * or an array, and the payload under `Data` or `data` — both shapes occur.
 * @param {string|Buffer} raw - The raw frame.
 * @returns {Array<{id: string, unitType: string|undefined}>} The units that changed.
 */
export function parseUnitStateFrames(raw) {
  let parsed;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
  } catch {
    return [];
  }
  const frames = Array.isArray(parsed) ? parsed : [parsed];
  const units = [];
  frames.forEach((frame) => {
    if (!frame || typeof frame !== 'object' || frame.messageType !== 'unitStateChanged') {
      return;
    }
    const data = frame.Data ?? frame.data;
    if (data && typeof data === 'object' && typeof data.id === 'string') {
      units.push({ id: data.id, unitType: data.unitType });
    }
  });
  return units;
}

/**
 * Build the real-time client.
 * @param {object} options - Options.
 * @param {Function} options.getApi - Returns the current MELCloud Home client, or null.
 * @param {Function} options.onUnitsChanged - Called (debounced) when units changed.
 * @param {object} options.logger - Logger.
 * @param {Function} [options.WebSocketImpl] - WebSocket constructor, injectable for tests.
 * @param {Function} [options.setTimeoutImpl] - Timer, injectable for tests.
 * @param {Function} [options.clearTimeoutImpl] - Timer cleanup, injectable for tests.
 * @param {number} [options.debounceMs] - Refresh debounce.
 * @returns {object} The client.
 */
export function createRealtimeClient({
  getApi,
  onUnitsChanged,
  logger,
  WebSocketImpl = WebSocket,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  debounceMs = REFRESH_DEBOUNCE,
} = {}) {
  let running = false;
  let socket = null;
  let reconnectTimer = null;
  let refreshTimer = null;
  let reconnectDelay = RECONNECT_INITIAL_DELAY;
  let lastFailure = null;

  function clearTimer(timer) {
    if (timer) {
      clearTimeoutImpl(timer);
    }
    return null;
  }

  // An optional socket must not fill the logs minute after minute: the reason
  // is logged when it changes, not on every attempt.
  function noteFailure(message) {
    if (lastFailure !== message) {
      lastFailure = message;
      logger.warn(`MELCloud Home real-time updates unavailable (${message}); polling continues`);
    }
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer) {
      return;
    }
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function scheduleRefresh(units) {
    refreshTimer = clearTimer(refreshTimer);
    refreshTimer = setTimeoutImpl(() => {
      refreshTimer = null;
      Promise.resolve()
        .then(() => onUnitsChanged(units))
        .catch((e) => logger.error('Real-time refresh failed:', e.message));
    }, debounceMs);
  }

  function handleMessage(raw) {
    const units = parseUnitStateFrames(raw);
    if (units.length > 0) {
      scheduleRefresh(units);
    }
  }

  async function connect() {
    if (!running || socket) {
      return;
    }
    const api = getApi();
    if (!api) {
      scheduleReconnect();
      return;
    }

    let hash;
    try {
      hash = await api.getWebSocketHash();
    } catch (e) {
      noteFailure(e.message);
      scheduleReconnect();
      return;
    }
    // `running` can have been cleared while the hash request was in flight.
    if (!running) {
      return;
    }

    let ws;
    try {
      ws = new WebSocketImpl(`${WS_ENDPOINT}/?hash=${encodeURIComponent(hash)}`);
    } catch (e) {
      noteFailure(e.message);
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.on('open', () => {
      reconnectDelay = RECONNECT_INITIAL_DELAY;
      lastFailure = null;
      logger.info('MELCloud Home real-time updates connected');
    });
    ws.on('message', handleMessage);
    // 'error' is always followed by 'close', which owns the reconnect.
    ws.on('error', (e) => noteFailure(e.message));
    ws.on('close', () => {
      if (socket !== ws) {
        return;
      }
      socket = null;
      scheduleReconnect();
    });
  }

  return {
    /**
     * Open the socket, and keep it open. Safe to call repeatedly.
     * @returns {void} Nothing.
     */
    start() {
      if (running) {
        return;
      }
      running = true;
      reconnectDelay = RECONNECT_INITIAL_DELAY;
      connect();
    },

    /**
     * Close the socket and stop reconnecting.
     * @returns {void} Nothing.
     */
    stop() {
      running = false;
      reconnectTimer = clearTimer(reconnectTimer);
      refreshTimer = clearTimer(refreshTimer);
      if (socket) {
        const ws = socket;
        socket = null;
        try {
          ws.close();
        } catch {
          // Already closing or dead.
        }
      }
    },

    /**
     * Reconnect with fresh credentials (the hash is tied to the account).
     * @returns {void} Nothing.
     */
    restart() {
      this.stop();
      this.start();
    },

    /**
     * Whether the socket is currently open.
     * @returns {boolean} True when connected.
     */
    isConnected() {
      return Boolean(socket) && socket.readyState === 1;
    },
  };
}
