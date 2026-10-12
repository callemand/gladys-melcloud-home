// Remote control dashboard widget, for one air conditioner (air-to-air unit).
//
// A card laid out like the physical remote: the room and target temperatures
// as live tiles, a status list (power, mode, fan speed, vanes), then the keys:
// power, setpoint down, setpoint up, and one key the user picks that steps
// through a setting, like the MODE / FAN / VANE keys of the remote.
//
// The widget vocabulary caps a card at four buttons, and the published SDK
// does not relay the values of a widget form yet: stepping keys are what fits.
//
// The texts are multi-language objects: the core picks the user's language.

import {
  AC_MODE,
  DEVICE_TYPE,
  FEATURE,
  buildDevice,
  getModeTemperatureBounds,
  readStates,
} from '../devices/airToAir.js';

export const REMOTE_WIDGET_KEY = 'remote';

// MELCloud Home can take a few seconds to report a command back. A value
// commanded from the widget is shown for this long, or until MELCloud agrees.
export const PENDING_TTL = 15000;

// The content changes with the unit, which pushes its changes in real time:
// the TTL is only the fallback when a refresh nudge is lost.
const CONTENT_TTL_SECONDS = 60;

const text = (en, fr, de, es) => ({ en, fr, de, es });

const LABELS = {
  room: text('Room', 'Ambiante', 'Raum', 'Ambiente'),
  target: text('Setpoint', 'Consigne', 'Sollwert', 'Consigna'),
  power: text('Power', 'Marche', 'Betrieb', 'Encendido'),
  on: text('On', 'Allumée', 'Ein', 'Encendida'),
  off: text('Off', 'Éteinte', 'Aus', 'Apagada'),
  turnOn: text('Turn on', 'Allumer', 'Einschalten', 'Encender'),
  turnOff: text('Turn off', 'Éteindre', 'Ausschalten', 'Apagar'),
  notConfigured: text(
    'Enter your MELCloud Home account in the integration configuration.',
    "Renseignez votre compte MELCloud Home dans la configuration de l'intégration.",
    'Geben Sie Ihr MELCloud Home-Konto in der Konfiguration der Integration ein.',
    'Introduzca su cuenta MELCloud Home en la configuración de la integración.',
  ),
  notFound: text(
    'This air conditioner is no longer in your MELCloud Home account.',
    "Cette climatisation n'est plus dans votre compte MELCloud Home.",
    'Diese Klimaanlage ist nicht mehr in Ihrem MELCloud Home-Konto.',
    'Este aire acondicionado ya no está en su cuenta MELCloud Home.',
  ),
  notAnAirConditioner: text(
    'This widget controls an air conditioner: pick one in the widget settings.',
    'Ce widget pilote une climatisation : choisissez-en une dans les réglages du widget.',
    'Dieses Widget steuert eine Klimaanlage: Wählen Sie eine in den Widget-Einstellungen.',
    'Este widget controla un aire acondicionado: elija uno en los ajustes del widget.',
  ),
};

const MODE_LABELS = {
  [AC_MODE.AUTO]: text('Auto', 'Auto', 'Automatik', 'Automático'),
  [AC_MODE.COOLING]: text('Cool', 'Froid', 'Kühlen', 'Frío'),
  [AC_MODE.DRYING]: text('Dry', 'Déshumidification', 'Entfeuchten', 'Deshumidificar'),
  [AC_MODE.HEATING]: text('Heat', 'Chaud', 'Heizen', 'Calor'),
  [AC_MODE.FAN]: text('Fan', 'Ventilation', 'Lüften', 'Ventilación'),
};

const speed = (rank) =>
  text(`Speed ${rank}`, `Vitesse ${rank}`, `Stufe ${rank}`, `Velocidad ${rank}`);
const FAN_SPEED_LABELS = {
  0: text('Auto', 'Auto', 'Automatik', 'Automático'),
  1: speed(1),
  2: speed(2),
  3: speed(3),
  4: speed(4),
  5: speed(5),
};

const AUTO = text('Auto', 'Auto', 'Automatik', 'Automático');
const SWING = text('Swing', 'Balayage', 'Schwenken', 'Oscilante');
const position = (rank) =>
  text(`Position ${rank}`, `Position ${rank}`, `Position ${rank}`, `Posición ${rank}`);

const SWING_VERTICAL_LABELS = {
  8: AUTO,
  1: SWING,
  2: position(1),
  3: position(2),
  4: position(3),
  5: position(4),
  6: position(5),
};

const SWING_HORIZONTAL_LABELS = {
  8: AUTO,
  1: SWING,
  2: text('Left', 'Gauche', 'Links', 'Izquierda'),
  3: text('Left centre', 'Centre gauche', 'Links Mitte', 'Centro izquierda'),
  4: text('Centre', 'Centre', 'Mitte', 'Centro'),
  5: text('Right centre', 'Centre droit', 'Rechts Mitte', 'Centro derecha'),
  6: text('Right', 'Droite', 'Rechts', 'Derecha'),
};

// The settings a key can step through, in the order of the status list. Mode
// follows the order of the physical remote; the others follow the options the
// unit declares (only the fan speeds it has, Auto first).
export const STEPPED_SETTINGS = {
  mode: {
    feature: FEATURE.MODE,
    name: text('Mode', 'Mode', 'Modus', 'Modo'),
    values: MODE_LABELS,
    order: [AC_MODE.AUTO, AC_MODE.COOLING, AC_MODE.DRYING, AC_MODE.HEATING, AC_MODE.FAN],
  },
  fan_speed: {
    feature: FEATURE.FAN_SPEED,
    name: text('Fan speed', 'Ventilation', 'Lüfterstufe', 'Ventilador'),
    values: FAN_SPEED_LABELS,
  },
  swing_vertical: {
    feature: FEATURE.SWING_VERTICAL,
    name: text('Vertical swing', 'Balayage vertical', 'Vertikal', 'Oscilación vertical'),
    values: SWING_VERTICAL_LABELS,
  },
  swing_horizontal: {
    feature: FEATURE.SWING_HORIZONTAL,
    name: text('Horizontal swing', 'Balayage horizontal', 'Horizontal', 'Oscilación horizontal'),
    values: SWING_HORIZONTAL_LABELS,
  },
};

export const DEFAULT_STEPPED_SETTING = 'mode';

/**
 * Remember the values commanded from the widget until MELCloud reports them.
 * @param {object} [options] - Options.
 * @param {number} [options.ttl] - How long a commanded value wins, in ms.
 * @param {Function} [options.now] - Clock, injectable for the tests.
 * @returns {{set: Function, overlay: Function}} The store.
 */
export function createPendingStates({ ttl = PENDING_TTL, now = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    /**
     * Record a commanded value.
     * @param {string} featureExternalId - The feature external id.
     * @param {number} value - The commanded Gladys value.
     * @returns {void} Nothing.
     */
    set(featureExternalId, value) {
      entries.set(featureExternalId, { value, expiresAt: now() + ttl });
    },

    /**
     * Apply the commanded values over the states read from MELCloud. An entry
     * is forgotten once it expires or once MELCloud reports the same value.
     * @param {Map} states - Gladys value by feature external id (modified).
     * @returns {Map} The same map.
     */
    overlay(states) {
      entries.forEach((entry, featureExternalId) => {
        if (entry.expiresAt <= now() || states.get(featureExternalId) === entry.value) {
          entries.delete(featureExternalId);
        } else {
          states.set(featureExternalId, entry.value);
        }
      });
      return states;
    },
  };
}

/**
 * The content shown instead of the remote when it cannot be drawn.
 * @param {'notConfigured'|'notFound'|'notAnAirConditioner'} reason - Why.
 * @returns {object} The widget content.
 */
export function buildRemoteMessageContent(reason) {
  return {
    version: 1,
    ttl_seconds: CONTENT_TTL_SECONDS,
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

function formatStep(sign, step) {
  const dot = `${sign}${step}°`;
  const comma = dot.replace('.', ',');
  return text(dot, comma, comma, comma);
}

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
 * The values a stepping key goes through for this unit.
 * @param {object} device - The Gladys device built from the unit.
 * @param {object} stepped - An entry of STEPPED_SETTINGS.
 * @param {string} featureExternalId - The feature external id.
 * @returns {Array<number>|null} The values, or null when the unit lacks the feature.
 */
function steppedValues(device, stepped, featureExternalId) {
  const feature = device.features.find((current) => current.external_id === featureExternalId);
  if (!feature) {
    return null;
  }
  if (stepped.order) {
    return stepped.order;
  }
  return feature.supported_options.map((option) => option.value);
}

/**
 * Build the remote control content of one air conditioner.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {object} [options] - Options.
 * @param {object} [options.settings] - The widget instance settings.
 * @param {object} [options.pending] - The store of createPendingStates.
 * @returns {object} The widget content.
 */
export function buildRemoteContent(gladys, unit, { settings = {}, pending } = {}) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const device = buildDevice(gladys, unit);
  const states = currentStates(gladys, unit, pending);
  const isOn = states.get(ids.feature(FEATURE.POWER)) === 1;

  const items = [
    {
      label: LABELS.power,
      value: isOn ? LABELS.on : LABELS.off,
      color: isOn ? 'success' : 'neutral',
    },
  ];
  Object.values(STEPPED_SETTINGS).forEach((stepped) => {
    const featureExternalId = ids.feature(stepped.feature);
    const value = states.get(featureExternalId);
    if (steppedValues(device, stepped, featureExternalId) && stepped.values[value]) {
      items.push({ label: stepped.name, value: stepped.values[value] });
    }
  });

  const step = temperatureStep(unit);
  const components = [
    { type: 'value', device_feature: ids.feature(FEATURE.ROOM_TEMPERATURE), label: LABELS.room },
    { type: 'value', device_feature: ids.feature(FEATURE.TEMPERATURE), label: LABELS.target },
    { type: 'status', items },
    {
      type: 'button',
      label: isOn ? LABELS.turnOff : LABELS.turnOn,
      icon: 'power',
      style: isOn ? 'secondary' : 'primary',
      action: { key: 'power', params: { value: isOn ? 0 : 1 } },
    },
    {
      type: 'button',
      label: formatStep('−', step),
      icon: 'minus',
      action: { key: 'temp_down', params: { delta: -step } },
    },
    {
      type: 'button',
      label: formatStep('+', step),
      icon: 'plus',
      action: { key: 'temp_up', params: { delta: step } },
    },
  ];

  const steppedKey = settings.button === undefined ? DEFAULT_STEPPED_SETTING : settings.button;
  const stepped = STEPPED_SETTINGS[steppedKey];
  if (stepped && steppedValues(device, stepped, ids.feature(stepped.feature))) {
    components.push({
      type: 'button',
      label: stepped.name,
      icon: 'refresh-cw',
      action: { key: 'step', params: { setting: steppedKey } },
    });
  }

  return { version: 1, ttl_seconds: CONTENT_TTL_SECONDS, components };
}

const roundToStep = (value, step) => Math.round(value / step) * step;

/**
 * Turn a tapped key into the feature change to send to the unit.
 * @param {object} gladys - The SDK instance.
 * @param {object} unit - Air-to-air unit.
 * @param {string} actionKey - The tapped key.
 * @param {object} params - The params declared on the key.
 * @param {object} [pending] - The store of createPendingStates.
 * @returns {{featureExternalId: string, value: number}} The change.
 */
export function planRemoteAction(gladys, unit, actionKey, params = {}, pending) {
  const ids = gladys.externalIds(DEVICE_TYPE, unit.id);
  const states = currentStates(gladys, unit, pending);

  if (actionKey === 'power') {
    return { featureExternalId: ids.feature(FEATURE.POWER), value: params.value === 1 ? 1 : 0 };
  }

  if (actionKey === 'temp_down' || actionKey === 'temp_up') {
    const featureExternalId = ids.feature(FEATURE.TEMPERATURE);
    const current = states.get(featureExternalId);
    const delta = Number(params.delta);
    if (typeof current !== 'number' || !Number.isFinite(delta) || delta === 0) {
      throw new Error('The setpoint of this air conditioner is unknown');
    }
    const step = temperatureStep(unit);
    const { min, max } = getModeTemperatureBounds(unit, states.get(ids.feature(FEATURE.MODE)));
    const value = Math.min(max, Math.max(min, roundToStep(current + delta, step)));
    return { featureExternalId, value };
  }

  if (actionKey === 'step') {
    const stepped = STEPPED_SETTINGS[params.setting];
    const featureExternalId = stepped && ids.feature(stepped.feature);
    const values = stepped && steppedValues(buildDevice(gladys, unit), stepped, featureExternalId);
    if (!values || values.length === 0) {
      throw new Error(`This air conditioner has no ${params.setting} setting`);
    }
    const index = values.indexOf(states.get(featureExternalId));
    return { featureExternalId, value: values[(index + 1) % values.length] };
  }

  throw new Error(`Unknown remote control key: ${actionKey}`);
}
