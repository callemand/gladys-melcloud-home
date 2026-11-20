import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REFRESH_INTERVAL, createWidgetRefresher } from '../src/widgetRefresh.js';

const setup = () => {
  let clock = 0;
  const sent = [];
  const timers = [];
  const refresher = createWidgetRefresher({
    request: () => sent.push(clock),
    now: () => clock,
    setTimeoutImpl: (callback, delay) => {
      timers.push({ callback, at: clock + delay });
      return {};
    },
  });
  // Moves the clock, firing each due timer at its own time.
  const advance = (ms) => {
    const target = clock + ms;
    timers
      .filter((timer) => timer.at <= target)
      .sort((a, b) => a.at - b.at)
      .forEach((timer) => {
        timers.splice(timers.indexOf(timer), 1);
        clock = timer.at;
        timer.callback();
      });
    clock = target;
  };
  return { refresher, sent, timers, advance };
};

test('the first refresh is sent at once', () => {
  const { refresher, sent } = setup();
  refresher.refresh();
  assert.deepEqual(sent, [0]);
});

test('a refresh inside the window is postponed to its end, never dropped', () => {
  const { refresher, sent, advance } = setup();
  refresher.refresh();
  advance(3000);
  refresher.refresh();
  assert.deepEqual(sent, [0]);
  advance(REFRESH_INTERVAL - 3000);
  assert.deepEqual(sent, [0, REFRESH_INTERVAL]);
});

test('a burst inside the window ends in one postponed refresh', () => {
  const { refresher, sent, timers, advance } = setup();
  refresher.refresh();
  advance(1000);
  refresher.refresh();
  refresher.refresh();
  refresher.refresh();
  assert.equal(timers.length, 1);
  advance(REFRESH_INTERVAL);
  assert.deepEqual(sent, [0, REFRESH_INTERVAL]);
});

test('a refresh after the window is sent at once', () => {
  const { refresher, sent, advance } = setup();
  refresher.refresh();
  advance(REFRESH_INTERVAL);
  refresher.refresh();
  assert.deepEqual(sent, [0, REFRESH_INTERVAL]);
});

test('a postponed refresh does not keep the process alive', () => {
  let unrefCalled = false;
  let clock = 0;
  const refresher = createWidgetRefresher({
    request: () => {},
    now: () => clock,
    setTimeoutImpl: () => ({
      unref: () => {
        unrefCalled = true;
      },
    }),
  });
  refresher.refresh();
  clock = 1;
  refresher.refresh();
  assert.equal(unrefCalled, true);
});
