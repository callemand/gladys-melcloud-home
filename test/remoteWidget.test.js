import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createFakeGladys } from './helpers/fakeGladys.js';
import { AC_MODE, AC_FAN_SPEED, AC_SWING_VERTICAL } from '../src/devices/airToAir.js';
import {
  STEPPED_SETTINGS,
  buildRemoteContent,
  buildRemoteMessageContent,
  createPendingStates,
  planRemoteAction,
  temperatureStep,
} from '../src/widgets/remote.js';

const gladys = createFakeGladys();
const id = (feature) => `ext:test:ata:unit-1:${feature}`;

const buildUnit = ({ settings = {}, capabilities = {} } = {}) => {
  const values = {
    Power: 'True',
    OperationMode: 'Cool',
    SetTemperature: '21',
    RoomTemperature: '23.5',
    SetFanSpeed: 'Two',
    VaneVerticalDirection: 'Auto',
    VaneHorizontalDirection: 'Swing',
    ...settings,
  };
  return {
    id: 'unit-1',
    givenDisplayName: 'Salon',
    capabilities: {
      minTempHeat: 10,
      maxTempHeat: 31,
      minTempCoolDry: 16,
      maxTempCoolDry: 31,
      minTempAutomatic: 16,
      maxTempAutomatic: 31,
      numberOfFanSpeeds: 3,
      ...capabilities,
    },
    settings: Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => ({ name, value })),
  };
};

const byType = (content, type) => content.components.filter((c) => c.type === type);
const statusValue = (content, label) =>
  byType(content, 'status')[0].items.find((item) => item.label.en === label)?.value;

// --- Content -----------------------------------------------------------------

test('the remote content passes the core rules', () => {
  const content = buildRemoteContent(gladys, buildUnit());
  assert.deepEqual(validateWidgetContent(content), []);
  ['notConfigured', 'notFound', 'notAnAirConditioner'].forEach((reason) => {
    assert.deepEqual(validateWidgetContent(buildRemoteMessageContent(reason)), []);
  });
});

test('the tiles follow the room and target temperatures live', () => {
  const tiles = byType(buildRemoteContent(gladys, buildUnit()), 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.device_feature),
    [id('room-temperature'), id('temperature')],
  );
});

test('the status list reads the unit state in every language', () => {
  const content = buildRemoteContent(gladys, buildUnit());
  assert.equal(statusValue(content, 'Power').fr, 'Allumée');
  assert.equal(statusValue(content, 'Mode').fr, 'Froid');
  assert.equal(statusValue(content, 'Fan speed').fr, 'Vitesse 2');
  assert.equal(statusValue(content, 'Vertical swing').fr, 'Auto');
  assert.equal(statusValue(content, 'Horizontal swing').fr, 'Balayage');
  byType(content, 'status')[0].items.forEach((item) => {
    ['en', 'fr', 'de', 'es'].forEach((language) => {
      assert.ok(item.label[language], `${item.label.en} label in ${language}`);
      assert.ok(item.value[language], `${item.label.en} value in ${language}`);
    });
  });
});

test('a unit without vanes shows no swing row and no swing key', () => {
  const unit = buildUnit({
    settings: { VaneVerticalDirection: undefined, VaneHorizontalDirection: undefined },
  });
  const content = buildRemoteContent(gladys, unit, { settings: { button: 'swing_vertical' } });
  assert.equal(statusValue(content, 'Vertical swing'), undefined);
  assert.equal(byType(content, 'button').length, 3);
});

test('the power key turns the unit off when on, on when off', () => {
  const on = byType(buildRemoteContent(gladys, buildUnit()), 'button')[0];
  assert.equal(on.label.fr, 'Éteindre');
  assert.deepEqual(on.action, { key: 'power', params: { value: 0 } });

  const off = byType(
    buildRemoteContent(gladys, buildUnit({ settings: { Power: 'False' } })),
    'button',
  )[0];
  assert.equal(off.label.fr, 'Allumer');
  assert.equal(off.style, 'primary');
  assert.deepEqual(off.action, { key: 'power', params: { value: 1 } });
});

test('the setpoint keys step by one degree, or half a degree when the unit can', () => {
  const [, down, up] = byType(buildRemoteContent(gladys, buildUnit()), 'button');
  assert.deepEqual(down.action.params, { delta: -1 });
  assert.deepEqual(up.action.params, { delta: 1 });

  const half = buildUnit({ capabilities: { hasHalfDegreeIncrements: true } });
  const [, halfDown] = byType(buildRemoteContent(gladys, half), 'button');
  assert.equal(temperatureStep(half), 0.5);
  assert.equal(halfDown.label.fr, '−0,5°');
  assert.equal(halfDown.label.en, '−0.5°');
});

test('the fourth key is the stepping key picked in the settings, mode by default', () => {
  const keys = (settings) =>
    byType(buildRemoteContent(gladys, buildUnit(), { settings }), 'button').map(
      (button) => button.action,
    );
  assert.deepEqual(keys({})[3], { key: 'step', params: { setting: 'mode' } });
  assert.deepEqual(keys({ button: 'fan_speed' })[3], {
    key: 'step',
    params: { setting: 'fan_speed' },
  });
  assert.equal(keys({ button: 'none' }).length, 3);
});

// --- Actions -----------------------------------------------------------------

test('the power key sends the declared value', () => {
  assert.deepEqual(planRemoteAction(gladys, buildUnit(), 'power', { value: 0 }), {
    featureExternalId: id('power'),
    value: 0,
  });
  assert.equal(planRemoteAction(gladys, buildUnit(), 'power', { value: 1 }).value, 1);
});

test('the setpoint keys move from the current setpoint, within the mode bounds', () => {
  const unit = buildUnit({ settings: { SetTemperature: '21.5' } });
  assert.deepEqual(planRemoteAction(gladys, unit, 'temp_up', { delta: 1 }), {
    featureExternalId: id('temperature'),
    value: 23,
  });
  const atMin = buildUnit({ settings: { SetTemperature: '16' } });
  assert.equal(planRemoteAction(gladys, atMin, 'temp_down', { delta: -1 }).value, 16);
  // Heating goes lower than cooling.
  const heating = buildUnit({ settings: { SetTemperature: '16', OperationMode: 'Heat' } });
  assert.equal(planRemoteAction(gladys, heating, 'temp_down', { delta: -1 }).value, 15);
});

test('a setpoint key refuses to guess an unknown setpoint', () => {
  const unit = buildUnit({ settings: { SetTemperature: undefined } });
  assert.throws(() => planRemoteAction(gladys, unit, 'temp_up', { delta: 1 }), /unknown/);
});

test('a stepping key moves to the next value and wraps around', () => {
  const unit = buildUnit();
  assert.equal(planRemoteAction(gladys, unit, 'step', { setting: 'mode' }).value, AC_MODE.DRYING);
  const fan = buildUnit({ settings: { SetFanSpeed: 'Three' } });
  // Three speeds: Auto, 1, 2, 3, then back to Auto.
  assert.equal(
    planRemoteAction(gladys, fan, 'step', { setting: 'fan_speed' }).value,
    AC_FAN_SPEED.AUTO,
  );
  // Vertical vane at Auto: next is Swing.
  assert.equal(
    planRemoteAction(gladys, unit, 'step', { setting: 'swing_vertical' }).value,
    AC_SWING_VERTICAL.SWING,
  );
});

test('a stepping key refuses a setting the unit lacks', () => {
  const unit = buildUnit({ settings: { VaneHorizontalDirection: undefined } });
  assert.throws(
    () => planRemoteAction(gladys, unit, 'step', { setting: 'swing_horizontal' }),
    /no swing_horizontal/,
  );
  assert.throws(() => planRemoteAction(gladys, unit, 'step', { setting: 'oops' }));
  assert.throws(() => planRemoteAction(gladys, unit, 'eject'), /Unknown/);
});

// --- Pending states ----------------------------------------------------------

test('a commanded value wins until MELCloud reports it or it expires', () => {
  let now = 0;
  const pending = createPendingStates({ ttl: 1000, now: () => now });
  pending.set(id('temperature'), 22);

  // MELCloud still reports 21: the widget keeps showing and stepping from 22.
  assert.equal(planRemoteAction(gladys, buildUnit(), 'temp_up', { delta: 1 }, pending).value, 23);

  // Expired: back to what MELCloud reports.
  now = 1000;
  assert.equal(planRemoteAction(gladys, buildUnit(), 'temp_up', { delta: 1 }, pending).value, 22);
});

test('a commanded value is forgotten once MELCloud reports it', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set(id('power'), 0);
  const reported = buildUnit({ settings: { Power: 'False' } });
  assert.equal(statusValue(buildRemoteContent(gladys, reported, { pending }), 'Power').en, 'Off');
  // Forgotten: a later "on" from the phone shows up at once.
  assert.equal(statusValue(buildRemoteContent(gladys, buildUnit(), { pending }), 'Power').en, 'On');
});

// --- Manifest ----------------------------------------------------------------

test('the manifest offers every stepping key, and None', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url)),
  );
  const [widget] = manifest.widgets;
  assert.equal(widget.key, 'remote');
  const button = widget.settings.find((setting) => setting.key === 'button');
  assert.deepEqual(
    button.options.map((option) => option.value),
    [...Object.keys(STEPPED_SETTINGS), 'none'],
  );
  const unit = widget.settings.find((setting) => setting.key === 'unit');
  assert.equal(unit.source, 'devices');
});
