// -----------------------------------------------------------------------------
// Scene triggers (pure): the alerts that APPEARED since the last state seen
// by a refresh. A trigger is one event per transition, never a repeated state:
// - `alert_raised`: any new pending Flo alert (its count went up);
// - `leak_detected`: a new critical or warning alert of the leak family
//   (water detected, drip, failed health test), or a Water Sensor that starts
//   reporting water — one per device and refresh;
// - `abnormal_flow`: a new critical or warning alert of the flow family.
// The "seen" state (alert counts, water flag) is kept in /data across
// restarts (src/store.js): an alert raised while the integration was down
// fires at the first refresh. A device never seen before fires nothing (its
// pending alerts are not new).
// -----------------------------------------------------------------------------

import { ALERT_CATEGORIES, SCENE_TRIGGERS } from './constants.js';
import { describeAlarm } from './flo/model.js';

/** The severities that may fire leak_detected / abnormal_flow. */
export const TRIGGER_SEVERITIES = ['critical', 'warning'];

/** What the triggers compare: `{ alarms: [{ id, count }], water }` (JSON, persisted). */
export function seenOf(reading) {
  return {
    alarms: reading.alarms.map(({ id, count }) => ({ id, count })),
    water: reading.water ?? null,
  };
}

/**
 * The events of one device: [{ key, data }]. `target`: { externalId, name }.
 * `seen`: the last seenOf() of it (undefined: never seen); `current`: its
 * reading (src/flo/model.js).
 */
export function alertEvents(target, seen, current, catalog, now) {
  if (!seen || !current) {
    return [];
  }
  const events = [];
  const base = (fields) => ({
    device: target.externalId,
    device_name: target.name,
    alarm_id: null,
    alarm_name: null,
    alarm_title: null,
    severity: null,
    category: null,
    source: 'alert',
    raised_at: new Date(now).toISOString(),
    ...fields,
  });
  let leak;
  let flow;
  for (const alarm of current.alarms) {
    const before = (seen.alarms ?? []).find((a) => a.id === alarm.id)?.count ?? 0;
    if (alarm.count <= before) {
      continue;
    }
    const a = describeAlarm(alarm, catalog);
    const data = base({
      alarm_id: a.id,
      alarm_name: a.name,
      alarm_title: a.title,
      severity: a.severity ?? null,
      category: a.category,
    });
    events.push({ key: SCENE_TRIGGERS.ALERT, data });
    if (TRIGGER_SEVERITIES.includes(a.severity)) {
      if (a.category === ALERT_CATEGORIES.LEAK) {
        leak ??= data;
      } else if (a.category === ALERT_CATEGORIES.FLOW) {
        flow ??= data;
      }
    }
  }
  if (!leak && current.kind === 'sensor' && current.water === true && seen.water !== true) {
    leak = base({ severity: 'critical', category: ALERT_CATEGORIES.LEAK, source: 'sensor' });
  }
  if (leak) {
    events.push({ key: SCENE_TRIGGERS.LEAK, data: leak });
  }
  if (flow) {
    events.push({ key: SCENE_TRIGGERS.FLOW, data: flow });
  }
  return events;
}
