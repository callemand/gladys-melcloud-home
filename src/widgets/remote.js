// "PAC MELCloud" dashboard widget, for one air-to-air unit.
//
// The same silhouette as the other heat pump integrations (Daikin, Faikout,
// Midea, Panasonic): the room and target temperatures as live tiles, their
// 24 h curve, a status list (state, mode, fan speed, vanes), then the keys:
// power, setpoint down, setpoint up, and "Settings", which opens a form with
// the mode, the fan speed and both vanes.
//
// The texts are multi-language objects: the core picks the user's language.
// The value labels are the core's, so the widget reads like the device card.

import {
  AC_MODE,
  DEVICE_TYPE,
  FEATURE,
  buildDevice,
  getModeTemperatureBounds,
  readStates,
} from '../devices/airToAir.js';

export const REMOTE_WIDGET_KEY = 'remote';

// The content changes with the unit, which pushes its changes in real time:
// the TTL is only the fallback when a refresh nudge is lost.
const CONTENT_TTL_SECONDS = 60;
// The core minimum: a "connecting" message must not outlive the connection.
const STARTING_TTL_SECONDS = 10;

// Values of the `chart` widget setting.
export const CHART = {
  TEMPERATURE: 'temperature',
  NONE: 'none',
};

export const ACTION = {
  POWER: 'power',
  TEMP_DOWN: 'temp_down',
  TEMP_UP: 'temp_up',
  SETTINGS: 'settings',
};

const text = (en, fr, de, es) => ({ en, fr, de, es });

const LABELS = {
  room: text('Room', 'Pièce', 'Raum', 'Estancia'),
  roomTemperature: text('Room temp.', 'Temp. pièce', 'Raumtemp.', 'Temp. estancia'),
  target: text('Setpoint', 'Consigne', 'Sollwert', 'Consigna'),
  chart: text(
    'Temperatures, 24 h',
    'Températures, 24 h',
    'Temperaturen, 24 h',
    'Temperaturas, 24 h',
  ),
  state: text('State', 'État', 'Zustand', 'Estado'),
  running: text('Running', 'En marche', 'In Betrieb', 'En marcha'),
  stopped: text('Off', 'Arrêt', 'Aus', 'Apagada'),
  turnOn: text('Turn on', 'Allumer', 'Einschalten', 'Encender'),
  turnOff: text('Turn off', 'Éteindre', 'Ausschalten', 'Apagar'),
  settings: text('Settings', 'Réglages', 'Einstellungen', 'Ajustes'),
  turnedOn: text('Starting up', 'En cours de démarrage', 'Wird gestartet', 'Arrancando'),
  turnedOff: text('Shutting down', "En cours d'extinction", 'Wird ausgeschaltet', 'Apagándose'),
  settingsSent: text(
    'Settings sent',
    'Réglages envoyés',
    'Einstellungen gesendet',
    'Ajustes enviados',
  ),
  unchanged: text('Nothing to change', 'Aucun changement', 'Keine Änderung', 'Sin cambios'),
  starting: text(
    'Connecting to MELCloud Home…',
    'Connexion à MELCloud Home en cours…',
    'Verbindung mit MELCloud Home wird hergestellt…',
    'Conectando con MELCloud Home…',
  ),
  connectionFailed: text(
    'Cannot connect to MELCloud Home: check your account in the integration configuration.',
    "Connexion à MELCloud Home impossible : vérifiez votre compte dans la configuration de l'intégration.",
    'Keine Verbindung zu MELCloud Home: Prüfen Sie Ihr Konto in der Konfiguration der Integration.',
    'No se puede conectar con MELCloud Home: compruebe su cuenta en la configuración de la integración.',
  ),
  notConfigured: text(
    'Enter your MELCloud Home account in the integration configuration.',
    "Renseignez votre compte MELCloud Home dans la configuration de l'intégration.",
    'Geben Sie Ihr MELCloud Home-Konto in der Konfiguration der Integration ein.',
    'Introduzca su cuenta MELCloud Home en la configuración de la integración.',
  ),
  notFound: text(
    'This heat pump is no longer in your MELCloud Home account.',
    "Cette PAC n'est plus dans votre compte MELCloud Home.",
    'Diese Wärmepumpe ist nicht mehr in Ihrem MELCloud Home-Konto.',
    'Esta bomba de calor ya no está en su cuenta MELCloud Home.',
  ),
  notAnAirConditioner: text(
    'This widget controls an air-to-air heat pump: pick one in the widget settings.',
    'Ce widget pilote une PAC air-air : choisissez-en une dans les réglages du widget.',
    'Dieses Widget steuert eine Luft-Luft-Wärmepumpe: Wählen Sie eine in den Widget-Einstellungen.',
    'Este widget controla una bomba de calor aire-aire: elija una en los ajustes del widget.',
  ),
};

const MODE_LABELS = {
  [AC_MODE.AUTO]: text('Auto', 'Auto', 'Automatisch', 'Auto'),
  [AC_MODE.COOLING]: text('Cooling', 'Refroidissement', 'Kühlen', 'Frío'),
  [AC_MODE.HEATING]: text('Heating', 'Chauffage', 'Heizen', 'Calor'),
  [AC_MODE.DRYING]: text('Drying', 'Déshumidification', 'Entfeuchten', 'Seco'),
  [AC_MODE.FAN]: text('Fan', 'Ventilation', 'Lüften', 'Ventilador'),
};

const FAN_SPEED_LABELS = {
  0: text('Auto', 'Auto', 'Automatisch', 'Auto'),
  1: text('Low', 'Faible', 'Niedrig', 'Baja'),
  2: text('Low-Med', 'Faible-Moyen', 'Niedrig-Mittel', 'Baja-Media'),
  3: text('Medium', 'Moyen', 'Mittel', 'Media'),
  4: text('Med-High', 'Moyen-Fort', 'Mittel-Hoch', 'Media-Alta'),
  5: text('High', 'Fort', 'Hoch', 'Alta'),
};

const AUTO = text('Auto', 'Auto', 'Automatisch', 'Auto');
const SWING = text('Swing', 'Balayage', 'Schwenken', 'Oscilante');
const position = (rank, en, fr, de, es) =>
  text(
    `Position ${rank}${en ? ` (${en})` : ''}`,
    `Position ${rank}${fr ? ` (${fr})` : ''}`,
    `Position ${rank}${de ? ` (${de})` : ''}`,
    `Posición ${rank}${es ? ` (${es})` : ''}`,
  );

const SWING_VERTICAL_LABELS = {
  8: AUTO,
  1: SWING,
  2: position(1, 'Top', 'Haut', 'Oben', 'Arriba'),
  3: position(2),
  4: position(3),
  5: position(4),
  6: position(5, 'Bottom', 'Bas', 'Unten', 'Abajo'),
};

const SWING_HORIZONTAL_LABELS = {
  8: AUTO,
  1: SWING,
  2: position(1, 'Left', 'Gauche', 'Links', 'Izquierda'),
  3: position(2),
  4: position(3, 'Center', 'Centre', 'Mitte', 'Centro'),
  5: position(4),
  6: position(5, 'Right', 'Droite', 'Rechts', 'Derecha'),
};

// The settings of the status list and of the form, in that order. `values`
// lists what the form offers: every mode, otherwise the options the unit
// declares on its feature (only the fan speeds it has, Auto first).
export const SETTINGS = [
  {
    key: 'mode',
    feature: FEATURE.MODE,
    name: text('Mode', 'Mode', 'Modus', 'Modo'),
    icon: 'sliders',
    labels: MODE_LABELS,
    values: [AC_MODE.AUTO, AC_MODE.COOLING, AC_MODE.HEATING, AC_MODE.DRYING, AC_MODE.FAN],
  },
  {
    key: 'fan_speed',
    feature: FEATURE.FAN_SPEED,
    name: text('Fan speed', 'Ventilation', 'Lüfter', 'Ventilador'),
    icon: 'wind',
    labels: FAN_SPEED_LABELS,
  },
  {
    key: 'swing_vertical',
    feature: FEATURE.SWING_VERTICAL,
    name: text('Vertical swing', 'Balayage vertical', 'Vertikaler Schwenk', 'Oscilación vertical'),
    icon: 'move',
    labels: SWING_VERTICAL_LABELS,
  },
  {
    key: 'swing_horizontal',
    feature: FEATURE.SWING_HORIZONTAL,
    name: text(
      'Horizontal swing',
      'Balayage horizontal',
      'Horizontaler Schwenk',
      'Oscilación horizontal',
    ),
    icon: 'move',
    labels: SWING_HORIZONTAL_LABELS,
  },
];

/**
 * A room name inside a sentence: "Salon" → "salon", but "SDB" stays "SDB".
 * @param {string} name - The room name, as the user typed it.
 * @returns {string} The name, its first letter lowered unless it is an acronym.
 */
function inSentence(name) {
  const [first, second] = name;
  if (second === undefined || second !== second.toLowerCase()) {
    return name;
  }
  return first.toLowerCase() + name.slice(1);
}

/**
 * Legend name of the room temperature: the room of the device when it has
 * one ("Temp. salon"), else a generic name ("Temp. pièce").
 * @param {string} [roomName] - Name of the Gladys room of the device.
 * @returns {object} The multi-language name.
 */
export function roomTemperatureName(roomName) {
  const room = typeof roomName === 'string' ? roomName.trim() : '';
  if (!room) {
    return LABELS.roomTemperature;
  }
  return text(
    `${room} temp.`,
    `Temp. ${inSentence(room)}`,
    `Temp. ${room}`,
    `Temp. ${inSentence(room)}`,
  );
}

/**
 * The content shown instead of the remote when it cannot be drawn.
 * @param {'starting'|'connectionFailed'|'notConfigured'|'notFound'|'notAnAirConditioner'} reason - Why.
 * @returns {object} The widget content.
 */
export function buildRemoteMessageContent(reason) {
  return {
    version: 1,
    ttl_seconds: reason === 'starting' ? STARTING_TTL_SECONDS : CONTENT_TTL_SECONDS,
    components: [{ type: 'text', variant: 'body', text: LABELS[reason] }],
  };
}

/**
 * Setpoint step of the unit: half a degree when it supports it.
 * @param {object} unit - Air-to-air unit.
 * @returns {number} The step in °C.
 */
export function temperatureStep(unit) {
  return (unit.capabilities || {}).hasHalfDegreeIncrements ? 0.5 : 1;
}

/**
 * A temperature in every language: a decimal point in English, a comma elsewhere.
 * @param {string} prefix - Text before the number, per language.
 * @param {number} value - The temperature in °C.
 * @returns {object} The multi-language text.
 */
function formatTemperature(prefix, value) {
  const dot = `${value} °C`;
  const comma = dot.replace('.', ',');
  return text(
    `${prefix.en}${dot}`,
    `${prefix.fr}${comma}`,
    `${prefix.de}${comma}`,
    `${prefix.es}${comma}`,
  );
}

const SIGNED = (sign) => text(sign, sign, sign, sign);
const SETPOINT_SET = text('Setpoint: ', 'Consigne : ', 'Sollwert: ', 'Consigna: ');

/**
 * Read the unit as the widget shows it: the published states, with the values
 * just commanded from the widget on top.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {object} [pending] - The store of createPendingStates.
 * @returns {Map} Gladys value by feature external id.
 */
function currentStates(gladys, unit, pending) {
  const states = new Map(
    readStates(gladys, unit).map((state) => [state.device_feature_external_id, state.state]),
  );
  return pending ? pending.overlay(states) : states;
}

/**
 * The values a setting takes on this unit, in the order the form lists them.
 * @param {object} device - The Gladys device built from the unit.
 * @param {object} setting - An entry of SETTINGS.
 * @param {string} featureExternalId - The feature external id.
 * @returns {Array<number>|null} The values, or null when the unit lacks the feature.
 */
function settingValues(device, setting, featureExternalId) {
  const feature = device.features.find((current) => current.external_id === featureExternalId);
  if (!feature) {
    return null;
  }
  if (setting.values) {
    return setting.values;
  }
  return [...feature.supported_options]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((option) => option.value)
    .filter((value) => setting.labels[value]);
}

/**
 * The settings this unit has, with their values and their current value.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {Map} states - Gladys value by feature external id.
 * @returns {Array<object>} The settings, in the order of SETTINGS.
 */
function unitSettings(gladys, unit, states) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const device = buildDevice(gladys, unit);
  return SETTINGS.map((setting) => {
    const featureExternalId = ids.feature(setting.feature);
    return {
      ...setting,
      featureExternalId,
      values: settingValues(device, setting, featureExternalId),
      current: states.get(featureExternalId),
    };
  }).filter((setting) => setting.values && setting.values.length > 0);
}

/**
 * The form of the Settings key: one select per setting the unit has,
 * pre-filled with its current value.
 * @param {Array<object>} settings - The result of unitSettings.
 * @returns {Array<object>} The action fields (at most 4).
 */
function buildSettingsFields(settings) {
  return settings.map((setting) => ({
    key: setting.key,
    type: 'select',
    label: setting.name,
    ...(setting.values.includes(setting.current) ? { default: String(setting.current) } : {}),
    options: setting.values.map((value) => ({
      value: String(value),
      label: setting.labels[value],
    })),
  }));
}

/**
 * Build the content of the widget for one air-to-air unit.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {object} [options] - Options.
 * @param {object} [options.settings] - The widget instance settings.
 * @param {object} [options.pending] - The store of createPendingStates.
 * @param {string} [options.roomName] - Name of the Gladys room of the device.
 * @returns {object} The widget content.
 */
export function buildRemoteContent(gladys, unit, { settings = {}, pending, roomName } = {}) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const states = currentStates(gladys, unit, pending);
  const isOn = states.get(ids.feature(FEATURE.POWER)) === 1;
  const unitSettingList = unitSettings(gladys, unit, states);
  const roomFeature = ids.feature(FEATURE.ROOM_TEMPERATURE);
  const targetFeature = ids.feature(FEATURE.TEMPERATURE);

  const components = [
    { type: 'value', device_feature: roomFeature, label: LABELS.room, icon: 'thermometer' },
    { type: 'value', device_feature: targetFeature, label: LABELS.target, icon: 'target' },
  ];

  if (settings.chart !== CHART.NONE) {
    components.push({
      type: 'chart',
      title: LABELS.chart,
      chart_type: 'line',
      device_features: [roomFeature, targetFeature],
      // The legend. Without it, Gladys names the curves after the features,
      // in English ("Room temperature", "Temperature"); a Gladys that predates
      // `series_names` ignores it and keeps doing so.
      series_names: [roomTemperatureName(roomName), LABELS.target],
      interval: 'last-day',
    });
  }

  components.push({
    type: 'status',
    items: [
      {
        label: LABELS.state,
        icon: 'power',
        value: isOn ? LABELS.running : LABELS.stopped,
        color: isOn ? 'success' : 'neutral',
      },
      ...unitSettingList
        .filter((setting) => setting.labels[setting.current])
        .map((setting) => ({
          label: setting.name,
          icon: setting.icon,
          value: setting.labels[setting.current],
        })),
    ],
  });

  const step = temperatureStep(unit);
  components.push(
    {
      type: 'button',
      label: isOn ? LABELS.turnOff : LABELS.turnOn,
      icon: 'power',
      style: isOn ? 'secondary' : 'primary',
      action: { key: ACTION.POWER, params: { value: isOn ? 0 : 1 } },
    },
    {
      type: 'button',
      label: formatTemperature(SIGNED('−'), step),
      icon: 'minus',
      action: { key: ACTION.TEMP_DOWN, params: { delta: -step } },
    },
    {
      type: 'button',
      label: formatTemperature(SIGNED('+'), step),
      icon: 'plus',
      action: { key: ACTION.TEMP_UP, params: { delta: step } },
    },
    {
      type: 'button',
      label: LABELS.settings,
      icon: 'sliders',
      action: { key: ACTION.SETTINGS, fields: buildSettingsFields(unitSettingList) },
    },
  );

  return { version: 1, ttl_seconds: CONTENT_TTL_SECONDS, components };
}

const roundToStep = (value, step) => Math.round(value / step) * step;

/**
 * Turn a tapped key into the feature changes to send to the unit, and the
 * message to show once they are sent.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {string} actionKey - The tapped key.
 * @param {object} [params] - The params declared on the key.
 * @param {object} [options] - Options.
 * @param {object} [options.values] - The form values of the Settings key.
 * @param {object} [options.pending] - The store of createPendingStates.
 * @returns {{changes: Array<{featureExternalId: string, value: number}>, message: object}}
 *   The changes (empty when there is nothing to send) and the toast.
 */
export function planRemoteAction(gladys, unit, actionKey, params = {}, { values, pending } = {}) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const states = currentStates(gladys, unit, pending);

  if (actionKey === ACTION.POWER) {
    const value = params.value === 1 ? 1 : 0;
    return {
      changes: [{ featureExternalId: ids.feature(FEATURE.POWER), value }],
      message: value === 1 ? LABELS.turnedOn : LABELS.turnedOff,
    };
  }

  if (actionKey === ACTION.TEMP_DOWN || actionKey === ACTION.TEMP_UP) {
    const featureExternalId = ids.feature(FEATURE.TEMPERATURE);
    const current = states.get(featureExternalId);
    const delta = Number(params.delta);
    if (typeof current !== 'number' || !Number.isFinite(delta) || delta === 0) {
      throw new Error('The setpoint of this heat pump is unknown');
    }
    const step = temperatureStep(unit);
    const { min, max } = getModeTemperatureBounds(unit, states.get(ids.feature(FEATURE.MODE)));
    const value = Math.min(max, Math.max(min, roundToStep(current + delta, step)));
    return {
      changes: [{ featureExternalId, value }],
      message: formatTemperature(SETPOINT_SET, value),
    };
  }

  if (actionKey === ACTION.SETTINGS) {
    if (!values || typeof values !== 'object') {
      throw new Error('The Settings form needs Gladys 5.2 or later');
    }
    const changes = unitSettings(gladys, unit, states)
      .filter((setting) => values[setting.key] !== undefined && values[setting.key] !== '')
      .map((setting) => ({ setting, value: Number(values[setting.key]) }))
      .filter(({ setting, value }) => setting.values.includes(value) && value !== setting.current)
      .map(({ setting, value }) => ({ featureExternalId: setting.featureExternalId, value }));
    return { changes, message: changes.length > 0 ? LABELS.settingsSent : LABELS.unchanged };
  }

  throw new Error(`Unknown remote control key: ${actionKey}`);
}
