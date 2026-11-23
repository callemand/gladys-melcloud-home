import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createFakeGladys } from './helpers/fakeGladys.js';
import { AC_MODE, AC_FAN_SPEED, AC_SWING_VERTICAL } from '../src/devices/airToAir.js';
import {
  ACTION,
  CHART,
  buildRemoteContent,
  buildRemoteMessageContent,
  planRemoteAction,
  temperatureStep,
} from '../src/widgets/remote.js';
import { createPendingStates } from '../src/pendingStates.js';

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
const button = (content, key) =>
  byType(content, 'button').find((component) => component.action.key === key);
const field = (content, key) =>
  button(content, ACTION.SETTINGS).action.fields.find((current) => current.key === key);
const plan = (unit, actionKey, params, options) =>
  planRemoteAction(gladys, unit, actionKey, params, options);

// --- Content -----------------------------------------------------------------

test('the widget content passes the core rules, with and without its chart', () => {
  assert.deepEqual(validateWidgetContent(buildRemoteContent(gladys, buildUnit())), []);
  const withoutChart = buildRemoteContent(gladys, buildUnit(), { settings: { chart: CHART.NONE } });
  assert.deepEqual(validateWidgetContent(withoutChart), []);
  ['notConfigured', 'notFound', 'notAnAirConditioner'].forEach((reason) => {
    assert.deepEqual(validateWidgetContent(buildRemoteMessageContent(reason)), []);
  });
});

test('the tiles follow the room and target temperatures live', () => {
  const tiles = byType(buildRemoteContent(gladys, buildUnit()), 'value');
  assert.deepEqual(
    tiles.map((tile) => [tile.device_feature, tile.label.fr, tile.icon]),
    [
      [id('room-temperature'), 'Pièce', 'thermometer'],
      [id('temperature'), 'Consigne', 'target'],
    ],
  );
});

test('the chart draws both temperatures over 24 h, unless the settings hide it', () => {
  const [chart] = byType(buildRemoteContent(gladys, buildUnit()), 'chart');
  assert.deepEqual(chart.device_features, [id('room-temperature'), id('temperature')]);
  assert.equal(chart.interval, 'last-day');
  assert.equal(chart.title.fr, 'Températures, 24 h');

  const hidden = buildRemoteContent(gladys, buildUnit(), { settings: { chart: CHART.NONE } });
  assert.equal(byType(hidden, 'chart').length, 0);
});

test('the status list reads the unit state with the core labels', () => {
  const content = buildRemoteContent(gladys, buildUnit());
  assert.equal(statusValue(content, 'State').fr, 'En marche');
  assert.equal(byType(content, 'status')[0].items[0].color, 'success');
  assert.equal(statusValue(content, 'Mode').fr, 'Refroidissement');
  assert.equal(statusValue(content, 'Fan speed').fr, 'Faible-Moyen');
  assert.equal(statusValue(content, 'Vertical swing').fr, 'Auto');
  assert.equal(statusValue(content, 'Horizontal swing').fr, 'Balayage');

  const off = buildRemoteContent(gladys, buildUnit({ settings: { Power: 'False' } }));
  assert.equal(statusValue(off, 'State').fr, 'Arrêtée');
  assert.equal(byType(off, 'status')[0].items[0].color, 'neutral');

  const positioned = buildRemoteContent(
    gladys,
    buildUnit({ settings: { VaneVerticalDirection: 'Five', VaneHorizontalDirection: 'Left' } }),
  );
  assert.equal(statusValue(positioned, 'Vertical swing').fr, 'Position 5 (Bas)');
  assert.equal(statusValue(positioned, 'Horizontal swing').fr, 'Position 1 (Gauche)');
});

test('a unit without vanes shows no swing row and no swing field', () => {
  const unit = buildUnit({
    settings: { VaneVerticalDirection: undefined, VaneHorizontalDirection: undefined },
  });
  const content = buildRemoteContent(gladys, unit);
  assert.equal(statusValue(content, 'Vertical swing'), undefined);
  assert.equal(statusValue(content, 'Horizontal swing'), undefined);
  assert.deepEqual(
    button(content, ACTION.SETTINGS).action.fields.map((current) => current.key),
    ['mode', 'fan_speed'],
  );
});

test('the power button turns the unit off when on, on when off', () => {
  const on = button(buildRemoteContent(gladys, buildUnit()), ACTION.POWER);
  assert.equal(on.label.fr, 'Éteindre');
  assert.equal(on.style, 'secondary');
  assert.deepEqual(on.action.params, { value: 0 });

  const off = button(
    buildRemoteContent(gladys, buildUnit({ settings: { Power: 'False' } })),
    ACTION.POWER,
  );
  assert.equal(off.label.fr, 'Allumer');
  assert.equal(off.style, 'primary');
  assert.deepEqual(off.action.params, { value: 1 });
});

test('the setpoint buttons step by one degree, or half a degree when the unit can', () => {
  const whole = buildRemoteContent(gladys, buildUnit());
  assert.equal(button(whole, ACTION.TEMP_DOWN).label.fr, '−1 °C');
  assert.equal(button(whole, ACTION.TEMP_UP).label.en, '+1 °C');

  const half = buildRemoteContent(
    gladys,
    buildUnit({ capabilities: { hasHalfDegreeIncrements: true } }),
  );
  assert.equal(button(half, ACTION.TEMP_DOWN).label.fr, '−0,5 °C');
  assert.equal(button(half, ACTION.TEMP_UP).label.en, '+0.5 °C');
  assert.deepEqual(button(half, ACTION.TEMP_UP).action.params, { delta: 0.5 });
  assert.equal(temperatureStep(buildUnit()), 1);
});

test('the Settings form offers what the unit has, pre-filled with its state', () => {
  const content = buildRemoteContent(gladys, buildUnit());
  const settings = button(content, ACTION.SETTINGS);
  assert.equal(settings.label.fr, 'Réglages');
  assert.deepEqual(
    settings.action.fields.map((current) => [current.key, current.type, current.label.fr]),
    [
      ['mode', 'select', 'Mode'],
      ['fan_speed', 'select', 'Ventilation'],
      ['swing_vertical', 'select', 'Balayage vertical'],
      ['swing_horizontal', 'select', 'Balayage horizontal'],
    ],
  );

  const mode = field(content, 'mode');
  assert.equal(mode.default, String(AC_MODE.COOLING));
  assert.deepEqual(
    mode.options.map((option) => option.label.fr),
    ['Auto', 'Refroidissement', 'Chauffage', 'Déshumidification', 'Ventilation'],
  );

  // A three-speed unit: Auto and its three speeds only.
  const fan = field(content, 'fan_speed');
  assert.equal(fan.default, String(AC_FAN_SPEED.LOW_MID));
  assert.deepEqual(
    fan.options.map((option) => option.label.fr),
    ['Auto', 'Faible', 'Faible-Moyen', 'Moyen'],
  );

  // Auto first, as in the vane features.
  const vertical = field(content, 'swing_vertical');
  assert.equal(vertical.default, String(AC_SWING_VERTICAL.AUTO));
  assert.deepEqual(
    vertical.options.map((option) => option.label.fr),
    [
      'Auto',
      'Balayage',
      'Position 1 (Haut)',
      'Position 2',
      'Position 3',
      'Position 4',
      'Position 5 (Bas)',
    ],
  );
  assert.ok(vertical.options.every((option) => typeof option.value === 'string'));
});

test('the Settings form leaves a field empty when the state is unknown', () => {
  const content = buildRemoteContent(gladys, buildUnit({ settings: { OperationMode: undefined } }));
  assert.equal(field(content, 'mode').default, undefined);
  assert.equal(statusValue(content, 'Mode'), undefined);
});

// --- Actions -----------------------------------------------------------------

test('the power button sends the declared value', () => {
  const { changes, message } = plan(buildUnit(), ACTION.POWER, { value: 0 });
  assert.deepEqual(changes, [{ featureExternalId: id('power'), value: 0 }]);
  assert.equal(message.fr, 'Éteinte');
  assert.equal(plan(buildUnit(), ACTION.POWER, { value: 1 }).message.fr, 'Allumée');
});

test('the setpoint buttons move from the current setpoint, within the mode bounds', () => {
  const { changes, message } = plan(buildUnit(), ACTION.TEMP_UP, { delta: 1 });
  assert.deepEqual(changes, [{ featureExternalId: id('temperature'), value: 22 }]);
  assert.equal(message.fr, 'Consigne : 22 °C');

  // Cooling stops at 16 °C even though heating goes down to 10 °C.
  const low = buildUnit({ settings: { SetTemperature: '16' } });
  assert.equal(plan(low, ACTION.TEMP_DOWN, { delta: -1 }).changes[0].value, 16);

  const half = buildUnit({
    settings: { SetTemperature: '21' },
    capabilities: { hasHalfDegreeIncrements: true },
  });
  const halfUp = plan(half, ACTION.TEMP_UP, { delta: 0.5 });
  assert.equal(halfUp.changes[0].value, 21.5);
  assert.equal(halfUp.message.fr, 'Consigne : 21,5 °C');
  assert.equal(halfUp.message.en, 'Setpoint: 21.5 °C');
});

test('a setpoint button refuses to guess an unknown setpoint', () => {
  const unit = buildUnit({ settings: { SetTemperature: undefined } });
  assert.throws(() => plan(unit, ACTION.TEMP_UP, { delta: 1 }), /setpoint/);
  assert.throws(() => plan(buildUnit(), ACTION.TEMP_UP, { delta: 0 }), /setpoint/);
});

test('the Settings form sends only what changed', () => {
  const { changes, message } = plan(buildUnit(), ACTION.SETTINGS, undefined, {
    values: {
      mode: String(AC_MODE.HEATING),
      fan_speed: String(AC_FAN_SPEED.LOW_MID),
      swing_vertical: '1',
      swing_horizontal: '1',
    },
  });
  assert.deepEqual(changes, [
    { featureExternalId: id('mode'), value: AC_MODE.HEATING },
    { featureExternalId: id('swing-vertical'), value: 1 },
  ]);
  assert.equal(message.fr, 'Réglages envoyés');
});

test('the Settings form ignores empty and unsupported values', () => {
  const { changes, message } = plan(
    buildUnit(),
    ACTION.SETTINGS,
    {},
    {
      values: { mode: '', fan_speed: String(AC_FAN_SPEED.HIGH), swing_vertical: '0' },
    },
  );
  // HIGH is a fifth speed: this unit has three. OFF (0) is no vane option.
  assert.deepEqual(changes, []);
  assert.equal(message.fr, 'Aucun changement');
});

test('the Settings form needs the values of a recent core', () => {
  assert.throws(() => plan(buildUnit(), ACTION.SETTINGS, {}, {}), /Gladys 5\.2/);
});

test('an unknown key is refused', () => {
  assert.throws(() => plan(buildUnit(), 'step', {}), /Unknown remote control key/);
});

// --- Pending states ----------------------------------------------------------

test('a commanded value wins until MELCloud reports it or it expires', () => {
  let now = 0;
  const pending = createPendingStates({ ttl: 1000, now: () => now });
  pending.set(id('temperature'), 22, 21);

  // MELCloud still reports 21: the widget keeps showing and stepping from 22.
  assert.equal(plan(buildUnit(), ACTION.TEMP_UP, { delta: 1 }, { pending }).changes[0].value, 23);

  // Expired: back to what MELCloud reports.
  now = 1000;
  assert.equal(plan(buildUnit(), ACTION.TEMP_UP, { delta: 1 }, { pending }).changes[0].value, 22);
});

test('a commanded value shows while MELCloud lags, then MELCloud takes over', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set(id('power'), 0, 1);
  // MELCloud still reports the unit on: the widget shows the command.
  assert.equal(
    statusValue(buildRemoteContent(gladys, buildUnit(), { pending }), 'State').en,
    'Off',
  );
  const reported = buildUnit({ settings: { Power: 'False' } });
  assert.equal(statusValue(buildRemoteContent(gladys, reported, { pending }), 'State').en, 'Off');
  // Forgotten: a later "on" from the phone shows up at once.
  assert.equal(
    statusValue(buildRemoteContent(gladys, buildUnit(), { pending }), 'State').en,
    'Running',
  );
});

test('the Settings form is pre-filled with the commanded values', () => {
  const pending = createPendingStates({ now: () => 0 });
  pending.set(id('mode'), AC_MODE.HEATING, AC_MODE.COOLING);
  const content = buildRemoteContent(gladys, buildUnit(), { pending });
  assert.equal(field(content, 'mode').default, String(AC_MODE.HEATING));
});

// --- Manifest ----------------------------------------------------------------

test('the manifest declares the "PAC MELCloud" widget and the core it needs', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url)),
  );
  // Widget action forms arrived in Gladys 5.2.0.
  assert.equal(manifest.gladys_version, '>=5.2.0');
  const [widget] = manifest.widgets;
  assert.equal(widget.key, 'remote');
  assert.equal(widget.label.fr, 'PAC MELCloud');
  const unit = widget.settings.find((setting) => setting.key === 'unit');
  assert.equal(unit.source, 'devices');
  const chart = widget.settings.find((setting) => setting.key === 'chart');
  assert.equal(chart.default, CHART.TEMPERATURE);
  assert.deepEqual(
    chart.options.map((option) => option.value),
    [CHART.TEMPERATURE, CHART.NONE],
  );
});
