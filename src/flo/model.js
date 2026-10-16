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

/** Pending alerts: [{ id, severity, count }], the ones with a count only. */
export function pendingAlarmsOf(info) {
  const list = info?.notifications?.pending?.alarmCount;
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((a) => ({
      id: finite(a?.id),
      severity: SEVERITIES.includes(a?.severity) ? a.severity : 'info',
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
        severity: SEVERITIES.includes(item.severity) ? item.severity : undefined,
      });
    }
  }
  return catalog;
}

/**
 * The family of an alarm, from its catalog name: water on the floor, a drip
 * or a failed health test (a leak in the pipes) -> leak; a fast or long flow,
 * a high use -> flow. The ids are not documented: the names are the safer key.
 */
export function categoryOf(name) {
  const n = String(name ?? '').toLowerCase();
  if (/water_detected|leak|drip|health_test_fail/.test(n)) {
    return ALERT_CATEGORIES.LEAK;
  }
  if (/flow|water_use|water_usage|usage/.test(n)) {
    return ALERT_CATEGORIES.FLOW;
  }
  return ALERT_CATEGORIES.OTHER;
}

/** A pending alarm with its catalog entry: { id, name, title, severity, category }. */
export function describeAlarm(alarm, catalog) {
  const entry = catalog?.get(alarm.id);
  const name = entry?.name ?? `alarm_${alarm.id}`;
  return {
    id: alarm.id,
    name,
    title: entry?.title ?? name,
    severity: alarm.severity ?? entry?.severity ?? 'info',
    category: entry ? categoryOf(entry.name) : ALERT_CATEGORIES.OTHER,
  };
}

/**
 * The "alert" binary of a shutoff: a leak or flow alert pending, or any
 * critical one (the only sure sign when the catalog could not be read).
 */
export function hasLeakAlert(reading, catalog) {
  return reading.alarms.some((alarm) => {
    const a = describeAlarm(alarm, catalog);
    return a.severity === 'critical' || a.category !== ALERT_CATEGORIES.OTHER;
  });
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
