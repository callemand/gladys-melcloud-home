import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  createRealtimeClient,
  parseUnitStateFrames,
  RECONNECT_INITIAL_DELAY,
  RECONNECT_MAX_DELAY,
} from '../src/realtime.js';

// --- Frame parsing -----------------------------------------------------------

test('parseUnitStateFrames reads a batched frame', () => {
  const raw = JSON.stringify([
    {
      messageType: 'unitStateChanged',
      Data: { id: 'unit-1', unitType: 'ata', settings: [{ name: 'Power', value: true }] },
    },
  ]);
  assert.deepEqual(parseUnitStateFrames(raw), [{ id: 'unit-1', unitType: 'ata' }]);
});

test('parseUnitStateFrames reads a bare frame and the lowercase payload key', () => {
  // Both shapes occur in the captures.
  const bare = JSON.stringify({
    messageType: 'unitStateChanged',
    data: { id: 'u', unitType: 'ata' },
  });
  assert.deepEqual(parseUnitStateFrames(bare), [{ id: 'u', unitType: 'ata' }]);
});

test('parseUnitStateFrames accepts a Buffer', () => {
  const raw = Buffer.from(JSON.stringify({ messageType: 'unitStateChanged', Data: { id: 'u' } }));
  assert.deepEqual(parseUnitStateFrames(raw), [{ id: 'u', unitType: undefined }]);
});

test('parseUnitStateFrames ignores anything that is not a unit change', () => {
  assert.deepEqual(parseUnitStateFrames('not json'), []);
  assert.deepEqual(parseUnitStateFrames('{}'), []);
  assert.deepEqual(parseUnitStateFrames(JSON.stringify({ messageType: 'pong' })), []);
  assert.deepEqual(parseUnitStateFrames(JSON.stringify([{ messageType: 'unitStateChanged' }])), []);
  assert.deepEqual(parseUnitStateFrames(JSON.stringify([null, 'x'])), []);
});

// --- Client ------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    FakeSocket.instances.push(this);
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.emit('close');
  }
}
FakeSocket.instances = [];

const silentLogger = { info() {}, warn() {}, error() {} };

// Deterministic timers: every scheduled callback is run by hand.
const createFakeTimers = () => {
  const pending = new Map();
  let nextId = 1;
  return {
    delays: [],
    setTimeoutImpl(fn, delay) {
      const id = nextId++;
      this.delays.push(delay);
      pending.set(id, fn);
      return id;
    },
    clearTimeoutImpl(id) {
      pending.delete(id);
    },
    runAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((fn) => fn());
    },
    get pendingCount() {
      return pending.size;
    },
  };
};

const setup = ({
  api = {
    async getWebSocketHash() {
      return 'HASH';
    },
  },
  onUnitsChanged = () => {},
} = {}) => {
  FakeSocket.instances = [];
  const timers = createFakeTimers();
  const client = createRealtimeClient({
    getApi: () => api,
    onUnitsChanged,
    logger: silentLogger,
    WebSocketImpl: FakeSocket,
    setTimeoutImpl: (fn, d) => timers.setTimeoutImpl(fn, d),
    clearTimeoutImpl: (id) => timers.clearTimeoutImpl(id),
    debounceMs: 10,
  });
  return { client, timers };
};

// The client fetches the hash asynchronously before opening the socket.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('start connects with the hash in the query string', async () => {
  const { client } = setup();
  client.start();
  await flush();

  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(FakeSocket.instances[0].url, 'wss://ws.melcloudhome.com/?hash=HASH');
  client.stop();
});

test('the hash is URL-encoded', async () => {
  const { client } = setup({
    api: {
      async getWebSocketHash() {
        return 'a b/c';
      },
    },
  });
  client.start();
  await flush();
  assert.equal(FakeSocket.instances[0].url, 'wss://ws.melcloudhome.com/?hash=a%20b%2Fc');
  client.stop();
});

test('start is idempotent', async () => {
  const { client } = setup();
  client.start();
  client.start();
  await flush();
  assert.equal(FakeSocket.instances.length, 1);
  client.stop();
});

test('a burst of frames triggers a single debounced refresh', async () => {
  let calls = 0;
  const { client, timers } = setup({
    onUnitsChanged: () => {
      calls += 1;
    },
  });
  client.start();
  await flush();
  const socket = FakeSocket.instances[0];
  socket.open();

  // One command makes the unit emit one frame per changed setting.
  ['Power', 'OperationMode', 'SetTemperature'].forEach((name) =>
    socket.emit(
      'message',
      JSON.stringify([
        { messageType: 'unitStateChanged', Data: { id: 'u1', settings: [{ name }] } },
      ]),
    ),
  );
  assert.equal(calls, 0, 'nothing runs before the debounce elapses');

  timers.runAll();
  await flush();
  assert.equal(calls, 1);
  client.stop();
});

test('a frame naming no unit triggers no refresh', async () => {
  let calls = 0;
  const { client, timers } = setup({
    onUnitsChanged: () => {
      calls += 1;
    },
  });
  client.start();
  await flush();
  FakeSocket.instances[0].emit('message', JSON.stringify({ messageType: 'pong' }));
  timers.runAll();
  await flush();
  assert.equal(calls, 0);
  client.stop();
});

test('a refresh that throws does not kill the client', async () => {
  const { client, timers } = setup({
    onUnitsChanged: () => {
      throw new Error('boom');
    },
  });
  client.start();
  await flush();
  const socket = FakeSocket.instances[0];
  socket.emit('message', JSON.stringify({ messageType: 'unitStateChanged', Data: { id: 'u' } }));
  timers.runAll();
  await flush();

  // Still live: a later frame is still processed.
  socket.emit('message', JSON.stringify({ messageType: 'unitStateChanged', Data: { id: 'u' } }));
  assert.ok(timers.pendingCount > 0);
  client.stop();
});

test('a closed socket reconnects with an exponential backoff', async () => {
  const { client, timers } = setup();
  client.start();
  await flush();

  FakeSocket.instances[0].close();
  assert.deepEqual(timers.delays, [RECONNECT_INITIAL_DELAY]);

  timers.runAll();
  await flush();
  assert.equal(FakeSocket.instances.length, 2);

  FakeSocket.instances[1].close();
  assert.equal(timers.delays[1], RECONNECT_INITIAL_DELAY * 2);
  client.stop();
});

test('the backoff resets once the socket opens again', async () => {
  const { client, timers } = setup();
  client.start();
  await flush();

  FakeSocket.instances[0].close();
  timers.runAll();
  await flush();
  FakeSocket.instances[1].open();
  FakeSocket.instances[1].close();

  // Back to the initial delay rather than continuing to grow.
  assert.equal(timers.delays[timers.delays.length - 1], RECONNECT_INITIAL_DELAY);
  client.stop();
});

test('the backoff is capped', () => {
  // Guard the constant itself: an uncapped backoff would drift past the poll
  // interval and leave the socket down for hours.
  assert.ok(RECONNECT_MAX_DELAY <= 60000);
});

test('a failing hash request is retried instead of giving up', async () => {
  let attempts = 0;
  const { client, timers } = setup({
    api: {
      async getWebSocketHash() {
        attempts += 1;
        throw new Error('401');
      },
    },
  });
  client.start();
  await flush();

  assert.equal(attempts, 1);
  assert.equal(FakeSocket.instances.length, 0, 'no socket without a hash');
  timers.runAll();
  await flush();
  assert.equal(attempts, 2);
  client.stop();
});

test('no API client yet: retried later, no socket', async () => {
  const { client, timers } = setup({ api: null });
  client.start();
  await flush();
  assert.equal(FakeSocket.instances.length, 0);
  assert.ok(timers.pendingCount > 0, 'a retry is scheduled');
  client.stop();
});

test('stop closes the socket and stops reconnecting', async () => {
  const { client, timers } = setup();
  client.start();
  await flush();
  const socket = FakeSocket.instances[0];

  client.stop();
  assert.ok(socket.closed);
  assert.equal(timers.pendingCount, 0);

  // A close arriving after stop must not schedule anything.
  socket.emit('close');
  assert.equal(timers.pendingCount, 0);
});

test('restart redials the socket', async () => {
  const { client } = setup();
  client.start();
  await flush();
  assert.equal(FakeSocket.instances.length, 1);

  client.restart();
  await flush();
  assert.equal(FakeSocket.instances.length, 2);
  assert.ok(FakeSocket.instances[0].closed);
  client.stop();
});

test('isConnected reflects the socket state', async () => {
  const { client } = setup();
  assert.equal(client.isConnected(), false);
  client.start();
  await flush();
  assert.equal(client.isConnected(), false, 'not until the socket opens');
  FakeSocket.instances[0].open();
  assert.equal(client.isConnected(), true);
  client.stop();
  assert.equal(client.isConnected(), false);
});
