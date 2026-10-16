// -----------------------------------------------------------------------------
// Scene triggers (pure): the alerts that APPEARED between two readings of a
// device. A trigger is one event per transition, never a repeated state:
// - `alert_raised`: any new pending Flo alert (its count went up);
// - `leak_detected`: a new leak alert (water detected, drip, failed health
//   test) or a Water Sensor that starts reporting water — one per reading;
// - `abnormal_flow`: a new flow alert (fast flow, long flow, high use).
// The first reading of a device fires nothing: the alerts already pending at
// start are not new.
// -----------------------------------------------------------------------------

import { ALERT_CATEGORIES, SCENE_TRIGGERS } from './constants.js';
import { describeAlarm } from './flo/model.js';

/**
 * The events of one device: [{ key, data }]. `target`: { externalId, name }.
 * `previous` / `current`: readings of src/flo/model.js.
 */
export function alertEvents(target, previous, current, catalog, now) {
  if (!previous || !current) {
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
    const before = previous.alarms.find((a) => a.id === alarm.id)?.count ?? 0;
    if (alarm.count <= before) {
      continue;
    }
    const a = describeAlarm(alarm, catalog);
    const data = base({
      alarm_id: a.id,
      alarm_name: a.name,
      alarm_title: a.title,
      severity: a.severity,
      category: a.category,
    });
    events.push({ key: SCENE_TRIGGERS.ALERT, data });
    if (a.category === ALERT_CATEGORIES.LEAK) {
      leak ??= data;
    } else if (a.category === ALERT_CATEGORIES.FLOW) {
      flow ??= data;
    }
  }
  if (!leak && current.kind === 'sensor' && current.water === true && previous.water !== true) {
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
