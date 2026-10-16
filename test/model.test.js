// -----------------------------------------------------------------------------
// The Flo answers -> values (src/flo/model.js), the configuration, the
// Gladys states and the scene events, on the fixtures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { statesOf } from '../src/devices.js';
import {
  catalogOf,
  categoryOf,
  consumptionOf,
  hasLeakAlert,
  localDay,
  locationsOf,
  readingOf,
  valveAtRest,
} from '../src/flo/model.js';
import { alertEvents } from '../src/triggers.js';
import { LOCATION, NOW, SENSOR, SHUTOFF, fixture } from './helpers/fakeFlo.js';

test('the locations and their devices', () => {
  const [home] = locationsOf(fixture('user.json'));
  assert.equal(home.id, LOCATION);
  assert.equal(home.name, 'Home');
  assert.equal(home.timezone, 'America/New_York');
  assert.deepEqual(
    home.devices.map((d) => d.id),
    [SHUTOFF, SENSOR, '9b9b9b9b-bridge-0003'],
  );
  assert.deepEqual(locationsOf({}), []);
});

test('a shutoff reading', () => {
  const r = readingOf(fixture('device-shutoff.json'));
  assert.equal(r.kind, 'shutoff');
  assert.equal(r.id, SHUTOFF);
  assert.equal(r.connected, true);
  assert.equal(r.valve, 'open');
  assert.equal(r.mode, 'home');
  assert.equal(r.flowGpm, 0);
  assert.equal(r.psi, 54.20000076293945);
  assert.equal(r.tempF, 70);
  assert.equal(r.locationId, LOCATION);
  assert.equal(valveAtRest(r), 'open');
});

test('a Water Sensor reading', () => {
  const r = readingOf(fixture('device-sensor.json'));
  assert.equal(r.kind, 'sensor');
  assert.equal(r.water, false);
  assert.equal(r.humidity, 48.5);
  assert.equal(r.battery, 87);
  const states = Object.fromEntries(statesOf(r).map(({ role, state }) => [role, state]));
  assert.deepEqual(states, { leak: 0, temperature: 18, humidity: 48.5, battery: 87 });
});

test('the valve is acted on only at rest, online, open or closed', () => {
  const base = readingOf(fixture('device-shutoff.json'));
  assert.equal(valveAtRest({ ...base, valve: 'closed', valveTarget: 'closed' }), 'closed');
  assert.equal(valveAtRest({ ...base, valve: 'closed', valveTarget: undefined }), 'closed');
  assert.equal(valveAtRest({ ...base, valve: 'open', valveTarget: 'closed' }), undefined);
  assert.equal(valveAtRest({ ...base, valve: 'opening', valveTarget: 'open' }), undefined);
  assert.equal(valveAtRest({ ...base, valve: undefined }), undefined);
  assert.equal(valveAtRest({ ...base, connected: false }), undefined);
  assert.equal(valveAtRest({ ...base, connected: undefined }), undefined);
  assert.equal(valveAtRest(undefined), undefined);
});

test('alert families from the alarm names', () => {
  assert.equal(categoryOf('fast_water_flow'), 'flow');
  assert.equal(categoryOf('high_water_usage'), 'flow');
  assert.equal(categoryOf('extended_water_use'), 'flow');
  assert.equal(categoryOf('small_drip'), 'leak');
  assert.equal(categoryOf('water_detected'), 'leak');
  assert.equal(categoryOf('health_test_failed'), 'leak');
  assert.equal(categoryOf('health_test_skipped'), 'other');
  assert.equal(categoryOf(undefined), 'other');
  const catalog = catalogOf(fixture('alarms.json'));
  assert.equal(catalog.get(10).title, 'Fast Water Flow');
  const r = readingOf(fixture('device-shutoff.json'));
  assert.equal(
    hasLeakAlert({ ...r, alarms: [{ id: 3, severity: 'info', count: 1 }] }, catalog),
    false,
  );
  assert.equal(
    hasLeakAlert({ ...r, alarms: [{ id: 28, severity: 'warning', count: 1 }] }, catalog),
    true,
  );
  // Without the catalog, only a critical alert counts.
  assert.equal(
    hasLeakAlert({ ...r, alarms: [{ id: 28, severity: 'warning', count: 1 }] }, new Map()),
    false,
  );
  assert.equal(
    hasLeakAlert({ ...r, alarms: [{ id: 77, severity: 'critical', count: 1 }] }, new Map()),
    true,
  );
});

test('consumption and the local day of the location', () => {
  assert.equal(consumptionOf(fixture('consumption.json')), 3.674);
  assert.equal(consumptionOf({ items: [{ gallonsConsumed: 1 }, { gallonsConsumed: 2.5 }] }), 3.5);
  assert.equal(consumptionOf({}), undefined);
  // 2026-10-13T05:00Z: 01:00 in New York, still the 12th in Los Angeles.
  assert.equal(localDay(NOW, 'America/New_York').day, '2026-10-13');
  assert.equal(localDay(NOW, 'America/Los_Angeles').day, '2026-10-12');
  assert.deepEqual(localDay(NOW, 'Not/AZone'), {
    day: '2026-10-13',
    startDate: '2026-10-13T00:00:00.000',
    endDate: '2026-10-13T23:59:59.999',
  });
});

test('the configuration: valves off by default, bounds, booleans from forms', () => {
  const c = normalizeConfig({});
  assert.equal(c.allowValveOpen, false);
  assert.equal(c.allowValveClose, false);
  assert.equal(c.loginMethod, 'auto');
  assert.equal(c.refreshInterval, 2);
  const d = normalizeConfig({
    email: ' a@b.c ',
    password: ' secret ',
    allow_valve_close: 'true',
    allow_valve_open: 'false',
    refresh_interval: '500',
    login_method: 'MOEN',
    language: 'de',
  });
  assert.equal(d.email, 'a@b.c');
  assert.equal(d.password, ' secret ', 'a password is never trimmed');
  assert.equal(d.allowValveClose, true);
  assert.equal(d.allowValveOpen, false);
  assert.equal(d.refreshInterval, 60);
  assert.equal(d.loginMethod, 'moen');
  assert.equal(d.language, 'fr');
});

test('alert events: only new alerts, one leak per reading', () => {
  const catalog = catalogOf(fixture('alarms.json'));
  const before = readingOf(fixture('device-sensor.json'));
  const after = {
    ...before,
    water: true,
    alarms: [{ id: 100, severity: 'critical', count: 1 }],
  };
  const target = { externalId: 'ext:flo:flo:x', name: 'Closet' };
  assert.deepEqual(alertEvents(target, undefined, after, catalog, NOW), [], 'first reading');
  const events = alertEvents(target, before, after, catalog, NOW);
  assert.deepEqual(
    events.map((e) => e.key),
    ['alert_raised', 'leak_detected'],
  );
  assert.equal(events[1].data.raised_at, new Date(NOW).toISOString());
  assert.deepEqual(alertEvents(target, after, after, catalog, NOW), []);
  // A count that goes up is a new occurrence.
  const again = { ...after, alarms: [{ id: 100, severity: 'critical', count: 2 }] };
  assert.equal(alertEvents(target, after, again, catalog, NOW).length, 2);
});
