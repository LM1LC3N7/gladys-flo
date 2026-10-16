// -----------------------------------------------------------------------------
// The Flo answers -> plain values (pure functions, no I/O).
//
// Field names follow aioflo's fixtures and the Home Assistant "Flo"
// integration that reads them: `telemetry.current.{gpm,psi,tempF,humidity}`,
// `valve.{lastKnown,target}`, `systemMode.{lastKnown,target,isLocked}`,
// `notifications.pending.alarmCount`, `fwProperties.telemetry_water` and
// `battery.level` (Water Sensor), `isConnected`.
// -----------------------------------------------------------------------------

import {
  ALERT_CATEGORIES,
  DEVICE_TYPES,
  IMPLAUSIBLE_WATER_TEMP_F,
  SEVERITIES,
  VALVE,
} from '../constants.js';

const finite = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const text = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const bool = (value) => (value === true ? true : value === false ? false : undefined);

/** The locations of the account, with their device ids (users/{id}?expand=locations). */
export function locationsOf(user) {
  const locations = Array.isArray(user?.locations) ? user.locations : [];
  return locations
    .filter((l) => text(l?.id))
    .map((l) => ({
      id: l.id,
      name: text(l.nickname) ?? text(l.address) ?? l.id,
      timezone: text(l.timezone),
      mode: text(l.systemMode?.lastKnown) ?? text(l.systemMode?.target),
      devices: (Array.isArray(l.devices) ? l.devices : [])
        .filter((d) => text(d?.id))
        .map((d) => ({ id: d.id, macAddress: text(d.macAddress) })),
    }));
}

/** The kind of a Flo device: the shutoff, the Water Sensor, or one we do not handle. */
export function kindOf(info) {
  if (info?.deviceType === DEVICE_TYPES.SHUTOFF) {
    return 'shutoff';
  }
  if (info?.deviceType === DEVICE_TYPES.SENSOR) {
    return 'sensor';
  }
  return 'other';
}

/** "Critical" -> "critical"; anything else than the three Flo severities -> undefined. */
export function severityOf(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  return SEVERITIES.includes(s) ? s : undefined;
}

/** Pending alerts: [{ id, severity, count }], the ones with a count only. */
export function pendingAlarmsOf(info) {
  const list = info?.notifications?.pending?.alarmCount;
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((a) => ({
      id: finite(a?.id),
      severity: severityOf(a?.severity),
      count: finite(a?.count) ?? 1,
    }))
    .filter((a) => a.id !== undefined && a.count > 0);
}

/** One device answer (GET /devices/{id}) -> a reading. Unknown values stay undefined. */
export function readingOf(info) {
  const current = info?.telemetry?.current ?? {};
  let tempF = finite(current.tempF);
  // A shutoff without a water temperature sensor reports a placeholder (225).
  if (tempF !== undefined && tempF >= IMPLAUSIBLE_WATER_TEMP_F) {
    tempF = undefined;
  }
  const pending = info?.notifications?.pending ?? {};
  return {
    id: String(info?.id ?? ''),
    kind: kindOf(info),
    type: text(info?.deviceType),
    model: text(info?.deviceModel),
    name: text(info?.nickname),
    macAddress: text(info?.macAddress),
    serial: text(info?.serialNumber),
    firmware: text(info?.fwVersion),
    locationId: text(info?.location?.id),
    connected: bool(info?.isConnected),
    valve: text(info?.valve?.lastKnown),
    valveTarget: text(info?.valve?.target),
    mode: text(info?.systemMode?.lastKnown),
    modeTarget: text(info?.systemMode?.target),
    modeLocked: info?.systemMode?.isLocked === true,
    flowGpm: finite(current.gpm),
    psi: finite(current.psi),
    tempF,
    humidity: finite(current.humidity),
    water: bool(info?.fwProperties?.telemetry_water),
    battery: finite(info?.battery?.level),
    alarms: pendingAlarmsOf(info),
    pendingCount: {
      critical: finite(pending.criticalCount) ?? 0,
      warning: finite(pending.warningCount) ?? 0,
      info: finite(pending.infoCount) ?? 0,
    },
  };
}

/**
 * The valve as the integration may act on it: "open" or "closed" when the
 * device is online and the valve is at rest on that position, undefined
 * otherwise (moving, broken, unknown, offline).
 */
export function valveAtRest(reading) {
  if (!reading || reading.connected !== true) {
    return undefined;
  }
  const { valve, valveTarget } = reading;
  if (valve !== VALVE.OPEN && valve !== VALVE.CLOSED) {
    return undefined;
  }
  // A target different from the last known position: the valve is moving.
  if (valveTarget !== undefined && valveTarget !== valve) {
    return undefined;
  }
  return valve;
}

/** The alarm catalog (GET /alarms) -> Map id -> { name, title, severity }. */
export function catalogOf(answer) {
  const items = Array.isArray(answer?.items) ? answer.items : Array.isArray(answer) ? answer : [];
  const catalog = new Map();
  for (const item of items) {
    const id = finite(item?.id);
    if (id !== undefined) {
      catalog.set(id, {
        name: text(item.name) ?? String(id),
        title: text(item.displayName) ?? text(item.name) ?? String(id),
        severity: severityOf(item.severity),
      });
    }
  }
  return catalog;
}

/**
 * Alarm names whose family is known, matched exactly (no pattern: a name we
 * do not know stays "other"). Taken from the names Flo exposes in the
 * fixtures of aioflo (`fwProperties` keys: high_flow_rate, high_water_use,
 * long_flow_event; health_test_*) and the alerts the Moen app and Home
 * Assistant users report (fast water flow, small drip, water detected). Not
 * confirmed on a real catalog: see TODO.md "To check".
 */
export const KNOWN_ALARMS = {
  [ALERT_CATEGORIES.LEAK]: new Set([
    'water_detected',
    'small_drip',
    'small_drip_category_1',
    'small_drip_category_2',
    'small_drip_category_3',
    'small_drip_category_4',
    'health_test_failed',
  ]),
  [ALERT_CATEGORIES.FLOW]: new Set([
    'fast_water_flow',
    'high_flow_rate',
    'high_water_usage',
    'high_water_use',
    'extended_water_use',
    'long_flow_event',
  ]),
};

/** The family of an alarm name: leak, flow, or other (unknown names included). */
export function categoryOf(name) {
  const n = String(name ?? '')
    .trim()
    .toLowerCase();
  for (const [category, names] of Object.entries(KNOWN_ALARMS)) {
    if (names.has(n)) {
      return category;
    }
  }
  return ALERT_CATEGORIES.OTHER;
}

/**
 * A pending alarm with its catalog entry: { id, name, title, severity,
 * category, known }. `known`: the catalog had the id. Without it (catalog
 * unavailable, or a new id) the family is "other" and the severity is the
 * only clue.
 */
export function describeAlarm(alarm, catalog) {
  const entry = catalog?.get(alarm.id);
  const name = entry?.name ?? `alarm_${alarm.id}`;
  return {
    id: alarm.id,
    name,
    title: entry?.title ?? name,
    severity: alarm.severity ?? entry?.severity,
    category: entry ? categoryOf(entry.name) : ALERT_CATEGORIES.OTHER,
    known: Boolean(entry),
  };
}

/**
 * The leak alert binary of a shutoff: a pending alert of the leak family; when
 * the catalog does not know an alert (unavailable), a critical one counts too,
 * by caution.
 */
export function hasLeakAlert(reading, catalog) {
  return reading.alarms.some((alarm) => {
    const a = describeAlarm(alarm, catalog);
    return a.known ? a.category === ALERT_CATEGORIES.LEAK : a.severity === 'critical';
  });
}

/** The pending alerts as one line: "Fast Water Flow (critical), Small Drip (warning)". */
export function alertsText(reading, catalog, none) {
  const parts = reading.alarms.map((alarm) => {
    const a = describeAlarm(alarm, catalog);
    return a.severity ? `${a.title} (${a.severity})` : a.title;
  });
  const line = parts.length ? parts.join(', ') : none;
  return line.length > 250 ? `${line.slice(0, 249)}…` : line;
}

/** Today's consumption in gallons (GET /water/consumption). */
export function consumptionOf(answer) {
  const total = finite(answer?.aggregations?.sumTotalGallonsConsumed);
  if (total !== undefined) {
    return total;
  }
  if (!Array.isArray(answer?.items)) {
    return undefined;
  }
  return answer.items.reduce((sum, item) => sum + (finite(item?.gallonsConsumed) ?? 0), 0);
}

/**
 * The local day of `now` in `timeZone` (the location's), as the naive local
 * date-times aioflo sends: `{ day, startDate, endDate }`. An unknown time
 * zone falls back to UTC.
 */
export function localDay(now, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now));
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(now));
  }
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  return { day, startDate: `${day}T00:00:00.000`, endDate: `${day}T23:59:59.999` };
}
