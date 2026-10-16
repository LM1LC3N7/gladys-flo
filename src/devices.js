// -----------------------------------------------------------------------------
// Flo devices -> Gladys devices, and their states (pure).
//
// One Gladys device per Flo device, `ext:<selector>:flo:<deviceId>`, the
// deviceId being the id the Flo cloud gives the device (stable, unique). The
// features are keyed by their role (the last part of their external id).
// Units are the ones the core lists for each category, fixed at creation.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TY,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { CONVERT, GLADYS, MODES } from './constants.js';
import { FEATURE_NAMES, T, TYPE_NAMES, word } from './i18n.js';
import { alertsText, hasLeakAlert } from './flo/model.js';

const binary = { min: 0, max: 1 };
const command = { read_only: false, has_feedback: true };

/** The features, by role. */
export const FEATURES = {
  // Shutoff
  valve: { category: C.SWITCH, type: TY.SWITCH.BINARY, ...binary, ...command },
  away: { category: C.SWITCH, type: TY.SWITCH.BINARY, ...binary, ...command },
  mode: { category: C.TEXT, type: TY.TEXT.TEXT, min: 0, max: 0, keep_history: false },
  flow: {
    category: C.WATER_VALVE,
    type: TY.WATER_VALVE.FLOW,
    unit: U.CUBIC_METER_PER_HOUR,
    min: 0,
    max: 30,
  },
  pressure: {
    category: C.PRESSURE_SENSOR,
    type: TY.SENSOR.DECIMAL,
    unit: U.PSI,
    min: 0,
    max: 200,
  },
  water_temperature: {
    category: C.TEMPERATURE_SENSOR,
    type: TY.TEMPERATURE_SENSOR.PROBE,
    unit: U.CELSIUS,
    min: -10,
    max: 100,
  },
  consumption_today: {
    category: C.VOLUME_SENSOR,
    type: TY.VOLUME_SENSOR.DECIMAL,
    unit: U.LITER,
    min: 0,
    max: 1_000_000,
  },
  // 1 while an alert of the leak family is pending (src/flo/model.js hasLeakAlert).
  leak_alert: { category: C.LEAK_SENSOR, type: TY.SENSOR.BINARY, ...binary },
  // Every pending alert, as text (flow alerts and the others included).
  alerts: { category: C.TEXT, type: TY.TEXT.TEXT, min: 0, max: 0, keep_history: false },
  // Water Sensor
  leak: { category: C.LEAK_SENSOR, type: TY.SENSOR.BINARY, ...binary },
  temperature: {
    category: C.TEMPERATURE_SENSOR,
    type: TY.SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: -40,
    max: 85,
  },
  humidity: {
    category: C.HUMIDITY_SENSOR,
    type: TY.SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  },
  battery: { category: C.BATTERY, type: TY.BATTERY.INTEGER, unit: U.PERCENT, min: 0, max: 100 },
};

export const ROLES = {
  shutoff: [
    'valve',
    'away',
    'mode',
    'flow',
    'pressure',
    'water_temperature',
    'consumption_today',
    'leak_alert',
    'alerts',
  ],
  sensor: ['leak', 'temperature', 'humidity', 'battery'],
};

/** The commands, by role. */
export const COMMAND_ROLES = ['valve', 'away'];

export const deviceIds = (gladys, id) => gladys.externalIds('flo', String(id));

/**
 * The Flo id and the role of a feature (or device) external id:
 * `ext:<selector>:flo:<id>[:<role>]` (the selector has no colon).
 */
export function parseExternalId(externalId) {
  const parts = String(externalId ?? '').split(':');
  if (parts[0] !== 'ext' || parts[2] !== 'flo' || !parts[3] || parts.length > 5) {
    return undefined;
  }
  return { id: parts[3], role: parts[4] };
}

export const deviceName = (device, language) =>
  device.name || `${word(TYPE_NAMES[device.kind], language)} ${String(device.id).slice(-4)}`;

function params(entries) {
  return entries
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([name, value]) => ({ name, value: String(value) }));
}

/** The Gladys device of one Flo device (`reading` of src/flo/model.js). */
export function buildDevice(gladys, device, language, locationName) {
  const ids = deviceIds(gladys, device.id);
  return {
    name: deviceName(device, language),
    external_id: ids.device,
    features: ROLES[device.kind].map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...FEATURES[role],
    })),
    params: params([
      ['flo_id', device.id],
      ['flo_type', device.type],
      ['model', device.model],
      ['mac_address', device.macAddress],
      ['location', locationName],
    ]),
  };
}

const round = (value, digits) =>
  value === undefined ? undefined : Number(value.toFixed(digits)) + 0;

const bit = (value) => (value ? GLADYS.ON : GLADYS.OFF);

/**
 * The Gladys states of one reading: `[{ role, state }]` or `[{ role, text }]`.
 * `extra`: { gallonsToday } (shutoff), `catalog` (alarm names), `language`.
 */
export function statesOf(device, { gallonsToday, catalog, language } = {}) {
  const states = [];
  const add = (role, state) => {
    if (state !== undefined && Number.isFinite(state)) {
      states.push({ role, state });
    }
  };
  if (device.kind === 'shutoff') {
    if (device.valve === 'open' || device.valve === 'closed') {
      add('valve', bit(device.valve === 'open'));
    }
    if (device.mode === MODES.HOME || device.mode === MODES.AWAY || device.mode === MODES.SLEEP) {
      // Sleep is not Away: the switch shows 0, the text says "sleep".
      add('away', bit(device.mode === MODES.AWAY));
      states.push({ role: 'mode', text: device.mode });
    }
    add(
      'flow',
      device.flowGpm === undefined ? undefined : round(CONVERT.gpmToM3h(device.flowGpm), 3),
    );
    add('pressure', round(device.psi, 1));
    add(
      'water_temperature',
      device.tempF === undefined ? undefined : round(CONVERT.fToC(device.tempF), 1),
    );
    add(
      'consumption_today',
      gallonsToday === undefined ? undefined : round(CONVERT.galToL(gallonsToday), 1),
    );
    add('leak_alert', bit(hasLeakAlert(device, catalog)));
    states.push({ role: 'alerts', text: alertsText(device, catalog, word(T.noAlert, language)) });
  } else if (device.kind === 'sensor') {
    add('leak', device.water === undefined ? undefined : bit(device.water));
    add(
      'temperature',
      device.tempF === undefined ? undefined : round(CONVERT.fToC(device.tempF), 1),
    );
    add('humidity', round(device.humidity, 1));
    add(
      'battery',
      device.battery === undefined
        ? undefined
        : Math.round(Math.max(0, Math.min(100, device.battery))),
    );
  }
  return states;
}
