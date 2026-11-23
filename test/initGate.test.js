import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_INIT_WAIT, INIT_WAIT, createInitGate } from '../src/initGate.js';

// A gate on a fake timer: `expire()` fires the pending wait timeouts.
const setup = () => {
  const timers = new Set();
  const gate = createInitGate({
    setTimeoutImpl: (callback, delay) => {
      const timer = { callback, delay };
      timers.add(timer);
      return timer;
    },
    clearTimeoutImpl: (timer) => timers.delete(timer),
  });
  const expire = () => {
    [...timers].forEach((timer) => {
      timers.delete(timer);
      timer.callback();
    });
  };
  return { gate, timers, expire };
};

// Resolves an initialization from the outside.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a request landing before the first initialization waits for it', async () => {
  const { gate } = setup();
  let settled = null;
  gate.wait().then((value) => {
    settled = value;
  });
  await flush();
  assert.equal(settled, null);

  const init = deferred();
  const run = gate.run(() => init.promise);
  await flush();
  assert.equal(settled, null);

  init.resolve();
  await run;
  await flush();
  assert.equal(settled, true);
});

test('a request waits for the initialization in progress', async () => {
  const { gate } = setup();
  const init = deferred();
  const run = gate.run(() => init.promise);
  let settled = null;
  gate.wait().then((value) => {
    settled = value;
  });
  await flush();
  assert.equal(settled, null);
  init.resolve();
  await run;
  await flush();
  assert.equal(settled, true);
});

test('a failed initialization releases the requests too', async () => {
  const { gate } = setup();
  const init = deferred();
  const run = gate.run(() => init.promise);
  const waiting = gate.wait();
  init.reject(new Error('login failed'));
  await assert.rejects(run, /login failed/);
  assert.equal(await waiting, true);
});

test('once initialized, a request does not wait', async () => {
  const { gate, timers } = setup();
  await gate.run(async () => {});
  assert.equal(await gate.wait(), true);
  assert.equal(timers.size, 0);
});

test('a request waits for every initialization in progress', async () => {
  const { gate } = setup();
  const first = deferred();
  const second = deferred();
  const runs = [gate.run(() => first.promise), gate.run(() => second.promise)];
  let settled = null;
  gate.wait().then((value) => {
    settled = value;
  });
  first.resolve();
  await runs[0];
  await flush();
  assert.equal(settled, null);
  second.resolve();
  await runs[1];
  await flush();
  assert.equal(settled, true);
});

test('the wait gives up after the bound, under the core command timeout', async () => {
  assert.ok(INIT_WAIT < 15000);
  const { gate, timers, expire } = setup();
  gate.run(() => new Promise(() => {}));
  const waiting = gate.wait();
  assert.equal(timers.size, 1);
  expire();
  assert.equal(await waiting, false);
});

test('a settled wait clears its timer', async () => {
  const { gate, timers } = setup();
  const init = deferred();
  const run = gate.run(() => init.promise);
  const waiting = gate.wait();
  assert.equal(timers.size, 1);
  init.resolve();
  await run;
  assert.equal(await waiting, true);
  assert.equal(timers.size, 0);
});

test('a command waits less, to answer before the core gives up on it after 5 s', async () => {
  assert.ok(COMMAND_INIT_WAIT <= 2000);
  const { gate, timers, expire } = setup();
  gate.run(() => new Promise(() => {}));
  const waiting = gate.wait({ timeout: COMMAND_INIT_WAIT });
  assert.deepEqual(
    [...timers].map((timer) => timer.delay),
    [COMMAND_INIT_WAIT],
  );
  expire();
  assert.equal(await waiting, false);
  // Without a bound of its own, a request waits the default one.
  gate.wait();
  assert.deepEqual(
    [...timers].map((timer) => timer.delay),
    [INIT_WAIT],
  );
});
