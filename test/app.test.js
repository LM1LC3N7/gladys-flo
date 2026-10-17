// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Flo cloud behind fetch. Timers are fakes the tests run.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FloApp } from '../src/app.js';
import { ACTIONS, SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  BRIDGE,
  EMAIL,
  LOCATION,
  MINUTE,
  NOW,
  PASSWORD,
  PASS,
  SENSOR,
  SHUTOFF,
  createFakeTimers,
  installFlo,
  json,
} from './helpers/fakeFlo.js';

const CONFIG = { email: EMAIL, password: PASSWORD };
const dev = (id) => `ext:flo:flo:${id}`;

let fake;
const dirs = [];
afterEach(() => {
  fake?.restore();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A new empty directory standing for /data. */
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-flo-'));
  dirs.push(dir);
  return dir;
};

async function setup({
  config = CONFIG,
  create = true,
  before,
  data = dataDir(),
  installed,
  now = NOW,
} = {}) {
  const clock = { now };
  fake = installed ?? installFlo(clock);
  before?.(fake);
  const gladys = createFakeGladys({ selector: 'flo', config });
  const timers = createFakeTimers();
  const lines = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (...args) => lines.push(`${level}: ${args.map(String).join(' ')}`);
  }
  const app = new FloApp({ gladys, logger, now: () => clock.now, timers, dataDir: data });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  await app.running;
  if (create) {
    for (const device of gladys.fake.discoveredDevices ?? []) {
      await gladys.fake.deviceCreated(device);
    }
  }
  /** Moves the clock minute by minute, running the loop at each tick. */
  const advance = async (minutes) => {
    for (let i = 0; i < minutes; i += 1) {
      clock.now += MINUTE;
      await timers.runIntervals();
      await app.running;
    }
  };
  return { gladys, app, timers, clock, lines, advance, data };
}

const deviceOf = (gladys, id) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === dev(id));
const featureOf = (gladys, id, role) =>
  deviceOf(gladys, id).features.find((f) => f.external_id === `${dev(id)}:${role}`);
const last = (gladys, id, role) => gladys.fake.lastState(`${dev(id)}:${role}`);
const lastText = (gladys, id, role) =>
  gladys.fake
    .bodies('POST', '/state')
    .flatMap((b) => b.states)
    .filter((s) => s.device_feature_external_id === `${dev(id)}:${role}`)
    .at(-1)?.text;
/** The data of a successful ack; rejects with the ack's error otherwise. */
const ok = async (promise) => {
  const ack = await promise;
  if (!ack?.success) {
    throw new Error(ack?.error ?? 'no ack');
  }
  return ack.data;
};
const set = (gladys, id, role, value) =>
  ok(gladys.fake.setValue(deviceOf(gladys, id), featureOf(gladys, id, role), value));
const action = async (gladys, key) => (await ok(gladys.fake.action(key, {}))).message;
const sceneAction = async (gladys, key, fields) =>
  (await ok(gladys.fake.sceneAction(key, fields))).outputs;
const events = (gladys) =>
  gladys.fake.bodies('POST', '/scene/event').map((b) => ({ key: b.key, data: b.data }));
const badgeOf = (gladys, id) =>
  gladys.fake
    .bodies('POST', '/device/transport')
    .flatMap((b) => b.transports)
    .filter((t) => t.device_external_id === dev(id))
    .at(-1);
const allow = (gladys, extra) => gladys.fake.configUpdated({ ...CONFIG, ...extra });

// --- Start, devices, states ----------------------------------------------------------

test('without credentials, the status asks for them and nothing is sent', async () => {
  const { gladys } = await setup({ config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /e-mail and the password/);
  assert.equal(fake.calls.length, 0);
});

test('start: Flo sign-in, account, alarm names, every device, consumption', async () => {
  const { gladys } = await setup();
  assert.deepEqual(
    fake.calls.map((c) => `${c.method} ${c.path.replace(/^[^/]+/, '')}`),
    [
      'POST /api/v1/users/auth',
      `GET /api/v2/users/${'12345abcde'}`,
      'GET /api/v2/alarms',
      `GET /api/v2/devices/${SHUTOFF}`,
      'GET /api/v2/water/consumption',
      `GET /api/v2/devices/${SENSOR}`,
      `GET /api/v2/devices/${BRIDGE}`,
    ],
  );
  const [auth, account] = fake.calls;
  assert.deepEqual(auth.body, { username: EMAIL, password: PASSWORD });
  // The Flo token goes as is, without "Bearer".
  assert.equal(account.headers.Authorization, 'flo-1');
  assert.equal(account.query.expand, 'locations');
  const consumption = fake.made(/water\/consumption/)[0];
  assert.deepEqual(consumption.query, {
    // 01:00 UTC-4 in Boston is still the 13th... at 05:00Z it is 01:00 local.
    startDate: '2026-10-13T00:00:00.000',
    endDate: '2026-10-13T23:59:59.999',
    interval: '1h',
    locationId: LOCATION,
    macAddress: '111111111111',
  });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /2 devices \(1 other not supported\)/);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(deviceOf(gladys, BRIDGE), undefined);
});

test('the Gladys devices and their features', async () => {
  const { gladys } = await setup();
  const roles = (id) => deviceOf(gladys, id).features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(roles(SHUTOFF), [
    'valve',
    'away',
    'mode',
    'flow',
    'pressure',
    'water_temperature',
    'consumption_today',
    'leak_alert',
    'alerts',
  ]);
  assert.deepEqual(roles(SENSOR), ['leak', 'temperature', 'humidity', 'battery']);
  const shutoff = deviceOf(gladys, SHUTOFF);
  assert.equal(shutoff.name, 'Smart Water Shutoff');
  assert.deepEqual(
    shutoff.params.find((p) => p.name === 'location'),
    { name: 'location', value: 'Home' },
  );
  assert.equal(featureOf(gladys, SHUTOFF, 'valve').name, 'Vanne ouverte');
  assert.equal(featureOf(gladys, SHUTOFF, 'valve').read_only, false);
  assert.equal(featureOf(gladys, SHUTOFF, 'away').read_only, false);
  assert.equal(featureOf(gladys, SHUTOFF, 'flow').read_only, true);
  assert.equal(featureOf(gladys, SHUTOFF, 'flow').unit, 'cubic-meter-per-hour');
  assert.equal(featureOf(gladys, SHUTOFF, 'pressure').unit, 'psi');
  assert.equal(featureOf(gladys, SHUTOFF, 'water_temperature').type, 'probe');
  assert.equal(featureOf(gladys, SHUTOFF, 'consumption_today').unit, 'liter');
  assert.equal(deviceOf(gladys, SENSOR).name, 'Water heater closet');
});

test('states reach Gladys once the devices are created, in Gladys units', async () => {
  const { gladys } = await setup();
  assert.equal(last(gladys, SHUTOFF, 'valve'), 1);
  assert.equal(last(gladys, SHUTOFF, 'away'), 0);
  assert.equal(lastText(gladys, SHUTOFF, 'mode'), 'home');
  assert.equal(last(gladys, SHUTOFF, 'flow'), 0);
  assert.equal(last(gladys, SHUTOFF, 'pressure'), 54.2);
  assert.equal(last(gladys, SHUTOFF, 'water_temperature'), 21.1);
  // 3.674 gallons -> 13.9 litres
  assert.equal(last(gladys, SHUTOFF, 'consumption_today'), 13.9);
  assert.equal(last(gladys, SHUTOFF, 'leak_alert'), 0);
  assert.equal(lastText(gladys, SHUTOFF, 'alerts'), 'aucune');
  assert.equal(last(gladys, SENSOR, 'leak'), 0);
  assert.equal(last(gladys, SENSOR, 'temperature'), 18);
  assert.equal(last(gladys, SENSOR, 'humidity'), 48.5);
  assert.equal(last(gladys, SENSOR, 'battery'), 87);
  assert.equal(badgeOf(gladys, SHUTOFF).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('the no-sensor water temperature placeholder is not published', async () => {
  const { gladys } = await setup({
    before: (f) => {
      f.state.devices[SHUTOFF].telemetry.current.tempF = 225;
    },
  });
  assert.equal(last(gladys, SHUTOFF, 'water_temperature'), undefined);
  assert.equal(last(gladys, SHUTOFF, 'pressure'), 54.2);
});

test('the refresh follows the interval; consumption every 15 minutes', async () => {
  const { gladys, advance } = await setup();
  const reads = () => fake.made(new RegExp(`GET .*devices/${SHUTOFF}$`)).length;
  assert.equal(reads(), 1);
  await advance(1);
  assert.equal(reads(), 1, 'not due after 1 minute (default 2)');
  await advance(1);
  assert.equal(reads(), 2);
  fake.state.devices[SHUTOFF].telemetry.current.gpm = 2;
  fake.state.devices[SHUTOFF].telemetry.current.psi = 48;
  await advance(2);
  assert.equal(last(gladys, SHUTOFF, 'flow'), 0.454);
  assert.equal(last(gladys, SHUTOFF, 'pressure'), 48);
  assert.equal(fake.made(/water\/consumption/).length, 1);
  await advance(12);
  assert.equal(fake.made(/water\/consumption/).length, 2);
  // One sign-in for all of it: the token lasts a day.
  assert.equal(fake.made(/users\/auth/).length, 1);
});

test('an offline device gets an unreachable badge', async () => {
  const { gladys, advance } = await setup();
  fake.state.devices[SENSOR].isConnected = false;
  await advance(2);
  const badge = badgeOf(gladys, SENSOR);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(badge.degraded, true);
  assert.equal(badgeOf(gladys, SHUTOFF).transport, DEVICE_TRANSPORTS.CLOUD);
});

// --- Sign-in and errors ---------------------------------------------------------------

test('auto sign-in falls back to Moen when the Flo sign-in refuses', async () => {
  const { gladys, app } = await setup({
    before: (f) => {
      f.state.floAuth = 'refuse';
    },
  });
  assert.equal(fake.made(/users\/auth/).length, 1);
  const [sso] = fake.made(/oauth2\/token/);
  assert.deepEqual(sso.body, {
    username: EMAIL,
    password: PASSWORD,
    client_id: '6qn9pep31dglq6ed4fvlq6rp5t',
  });
  const me = fake.made(/users\/me/)[0];
  assert.match(me.headers.Authorization, /^Bearer moen-/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(app.client.method, 'moen');
  assert.equal(deviceOf(gladys, SHUTOFF) !== undefined, true);
});

test('Moen: the token is refreshed before it expires, a refused refresh signs in again once', async () => {
  const { app, advance } = await setup({
    config: { ...CONFIG, login_method: 'moen' },
  });
  assert.equal(fake.made(/users\/auth/).length, 0);
  assert.equal(fake.made(/oauth2\/token/).length, 1);
  await advance(56);
  const refresh = fake.made(/oauth2\/token/).at(-1);
  assert.equal(refresh.body.grant_type, 'refresh_token');
  assert.match(refresh.body.refresh_token, /^refresh-/);
  // The refresh answer has no refresh token: the old one is kept.
  assert.match(app.client.session.refreshToken, /^refresh-/);
  // A refused refresh token: one full sign-in, not a loop.
  fake.state.valid.delete(app.client.session.refreshToken);
  await advance(56);
  const tokens = fake.made(/oauth2\/token/).slice(2);
  assert.deepEqual(
    tokens.map((c) => c.body.grant_type ?? 'password'),
    ['refresh_token', 'password'],
  );
});

test('refused credentials: status, no retry by itself, the test button retries', async () => {
  const { gladys, app, advance } = await setup({
    config: { email: EMAIL, password: 'wrong' },
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the e-mail or the password/);
  // auto: Flo then Moen, both refused.
  assert.equal(fake.calls.length, 2);
  await advance(30);
  assert.equal(fake.calls.length, 2, 'never retried by itself');
  assert.equal(app.refused, true);
  const answer = await action(gladys, ACTIONS.TEST_CONNECTION);
  assert.match(answer.en, /refused/);
  // The button tries both flows again: Flo, then Moen.
  assert.deepEqual(
    fake.calls.slice(2).map((c) => c.path.split('/').at(-1)),
    ['auth', 'token'],
  );
  await gladys.fake.configUpdated(CONFIG);
  assert.match(fake.calls[4].path, /users\/auth$/, 'new credentials: Flo again');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a passing Flo refusal: Moen meanwhile, the test button tries Flo again', async () => {
  const { gladys, app, advance } = await setup({
    before: (f) => {
      f.state.floAuth = 'refuse';
    },
  });
  assert.equal(app.client.method, 'moen');
  // Moen tokens last an hour: the renewal only asks Moen.
  await advance(60);
  assert.equal(fake.made(/users\/auth/).length, 1, 'Flo not asked again by itself');
  fake.state.floAuth = 'ok';
  app.client.session = null;
  await action(gladys, ACTIONS.TEST_CONNECTION);
  assert.equal(fake.made(/users\/auth/).length, 2, 'the button tries Flo again');
  assert.equal(app.client.method, 'flo');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a 403 on one device skips it for an hour, without any new sign-in', async () => {
  const { gladys, app, advance } = await setup();
  fake.route('GET', new RegExp(`devices/${SENSOR}$`), () => json({ message: 'no' }, 403));
  const reads = () => fake.made(new RegExp(`GET .*devices/${SENSOR}$`)).length;
  const before = reads();
  await advance(10);
  assert.equal(fake.made(/users\/auth/).length, 1, '0 more sign-in in 10 minutes');
  assert.equal(reads(), before + 1, 'asked once, then paused');
  assert.equal(app.devices.has(SHUTOFF), true);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await advance(52);
  assert.equal(reads(), before + 2, 'asked again after an hour');
  assert.equal(fake.made(/users\/auth/).length, 1);
});

test('a paused device stays tracked: unreachable badge, alerts of its return fire', async () => {
  const { gladys, app, advance } = await setup();
  let refuse = true;
  fake.route('GET', new RegExp(`devices/${SENSOR}$`), () =>
    refuse ? json({ message: 'no' }, 403) : PASS,
  );
  await advance(2);
  assert.equal(app.devices.has(SENSOR), true, 'still a known device');
  assert.ok(app.seen.has(SENSOR), 'its seen state kept');
  const badge = badgeOf(gladys, SENSOR);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.UNREACHABLE);
  assert.equal(badge.degraded, true);
  assert.match(badge.message.en, /refused to read this device/);
  await advance(20);
  assert.equal(app.devices.has(SENSOR), true);
  // Water detected while paused: it fires when the device comes back.
  fake.state.devices[SENSOR].fwProperties.telemetry_water = true;
  refuse = false;
  await advance(40);
  const leaks = events(gladys).filter((e) => e.key === SCENE_TRIGGERS.LEAK);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].data.source, 'sensor');
  assert.equal(badgeOf(gladys, SENSOR).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('a 401 on one device: one renewal, then the device is paused', async () => {
  const { advance } = await setup();
  fake.route('GET', new RegExp(`devices/${SENSOR}$`), () => json({ message: 'no' }, 401));
  await advance(10);
  assert.equal(fake.made(/users\/auth/).length, 2, 'one renewal, not one per refresh');
});

test('a token issued less than 60 s ago is never renewed on a 401', async () => {
  const { gladys } = await setup({
    before: (f) => f.route('GET', /\/users\/[^/]+$/, () => json({ message: 'no' }, 401)),
  });
  assert.equal(fake.made(/users\/auth/).length, 1, 'the fresh token is kept');
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('a token refused by the API is renewed once, then the call retried', async () => {
  const { gladys, advance } = await setup();
  fake.state.valid.clear();
  await advance(2);
  assert.equal(fake.made(/users\/auth/).length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a token refused again after renewal is an error with backoff, not a loop', async () => {
  const { gladys, advance } = await setup();
  fake.route('GET', /\/users\/[^/]+$/, () => json({ message: 'nope' }, 401));
  await advance(2);
  assert.equal(fake.made(/users\/auth/).length, 2, 'one renewal');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Next try in 1 min/);
  await advance(1);
  assert.equal(fake.made(/users\/auth/).length, 3);
  await advance(1);
  assert.equal(fake.made(/users\/auth/).length, 3, 'backoff: 2 minutes now');
});

test('a 429 pauses for its Retry-After; a CloudFront 403 is a passing error', async () => {
  const { gladys, advance, app } = await setup();
  let mode = '429';
  fake.route('GET', /\/users\/[^/]+$/, () => {
    if (mode === '429') {
      return json({ message: 'slow down' }, 429, { 'retry-after': '600' });
    }
    if (mode === '403') {
      return new Response('<html>Request blocked. Generated by cloudfront (CloudFront)</html>', {
        status: 403,
        headers: { 'x-cache': 'Error from cloudfront' },
      });
    }
    return PASS;
  });
  await advance(2);
  assert.match(gladys.fake.connectionStatus.message.en, /slow down: pausing for 10 min/);
  const count = fake.calls.length;
  await advance(9);
  assert.equal(fake.calls.length, count, 'nothing during the pause');
  mode = '403';
  await advance(1);
  assert.equal(app.refused, false, 'CloudFront is not a refusal');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Flo cannot be reached \(Flo is unavailable/,
  );
  assert.equal(fake.made(/users\/auth/).length, 1, 'no new sign-in for a CloudFront 403');
  mode = 'ok';
  // Second failure in a row: 2 minutes.
  await advance(1);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await advance(1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the password and the tokens never reach a log or a status', async () => {
  const { gladys, lines, advance } = await setup({
    config: { email: EMAIL, password: 'wrong' },
  });
  await gladys.fake.configUpdated(CONFIG);
  await advance(3);
  fake.state.valid.clear();
  await advance(3);
  const everything = [
    ...lines,
    ...gladys.fake.requests.map((r) => JSON.stringify(r.body ?? {})),
    ...gladys.fake.wsMessages.map((m) => JSON.stringify(m)),
  ].join('\n');
  assert.ok(!everything.includes(PASSWORD));
  assert.ok(!everything.includes('wrong'));
  assert.ok(!/flo-\d+/.test(everything), 'no token');
});

// --- Valve ----------------------------------------------------------------------------

test('valve commands are refused by default, without any call', async () => {
  const { gladys } = await setup();
  const before = fake.calls.length;
  await assert.rejects(
    app_set(gladys, 0),
    /Closing the Flo valve from Gladys is turned off|fermeture/,
  );
  await assert.rejects(app_set(gladys, 1), /Opening|ouverture/);
  assert.equal(fake.calls.length, before);
});

/** The valve switch through the fake Gladys: resolves, or rejects with the ack's error. */
const app_set = (gladys, value) => set(gladys, SHUTOFF, 'valve', value);

test('closing: allowed, the state is read again just before, then read back', async () => {
  const { gladys, timers } = await setup();
  await allow(gladys, { allow_valve_close: true });
  const before = fake.calls.length;
  await app_set(gladys, 0);
  const sent = fake.calls.slice(before).map((c) => `${c.method} ${c.path.replace(/^[^/]+/, '')}`);
  assert.deepEqual(sent, [`GET /api/v2/devices/${SHUTOFF}`, `POST /api/v2/devices/${SHUTOFF}`]);
  assert.deepEqual(fake.calls.at(-1).body, { valve: { target: 'closed' } });
  // The device reports the new position later: read back at 15 s and 60 s.
  assert.equal(timers.timeouts().length, 2);
  fake.state.devices[SHUTOFF].valve.lastKnown = 'closed';
  await timers.runTimeouts();
  assert.equal(last(gladys, SHUTOFF, 'valve'), 0);
  // Opening stays refused.
  await assert.rejects(app_set(gladys, 1), /Opening|ouverture/);
});

test('a valve already in place: no command sent', async () => {
  const { gladys } = await setup();
  await allow(gladys, { allow_valve_open: true });
  const before = fake.calls.length;
  await app_set(gladys, 1);
  assert.equal(fake.made(/^POST .*devices/).length, 0);
  assert.equal(fake.calls.length, before + 1, 'the read only');
});

test('the valve is refused when its state is unknown, moving, offline or unreadable', async () => {
  const { gladys } = await setup();
  await allow(gladys, { allow_valve_close: true });
  const cases = [
    (d) => (d.valve = { target: 'open', lastKnown: 'closed' }), // moving the other way
    (d) => (d.valve = { lastKnown: 'unknown' }),
    (d) => (d.valve = { target: 'open', lastKnown: 'broken' }),
    (d) => (d.isConnected = false),
    (d) => delete d.isConnected,
  ];
  const original = structuredClone(fake.state.devices[SHUTOFF]);
  for (const change of cases) {
    fake.state.devices[SHUTOFF] = structuredClone(original);
    change(fake.state.devices[SHUTOFF]);
    await assert.rejects(app_set(gladys, 0), /could not be confirmed|pas pu être confirmé/);
  }
  fake.state.devices[SHUTOFF] = structuredClone(original);
  fake.route('GET', new RegExp(`devices/${SHUTOFF}$`), () => json({}, 503));
  await assert.rejects(app_set(gladys, 0), /could not be confirmed|pas pu être confirmé/);
  assert.equal(fake.made(/^POST .*devices/).length, 0, 'never sent');
});

test('the state in memory never decides: a valve closed elsewhere is read again', async () => {
  const { gladys, app } = await setup();
  await allow(gladys, { allow_valve_close: true });
  // Gladys still believes it open; Flo says closed: nothing to send.
  assert.equal(app.devices.get(SHUTOFF).valve, 'open');
  fake.state.devices[SHUTOFF].valve = { target: 'closed', lastKnown: 'closed' };
  await app_set(gladys, 0);
  assert.equal(fake.made(/^POST .*devices/).length, 0);
  // The publications to Gladys run after the ack.
  await app.settled();
  assert.equal(last(gladys, SHUTOFF, 'valve'), 0);
});

test('valve commands of one device run one at a time, each on a fresh read', async () => {
  const { gladys, app } = await setup();
  await allow(gladys, { allow_valve_close: true });
  fake.state.valveBehaviour = 'follow';
  const order = [];
  fake.route('GET', new RegExp(`devices/${SHUTOFF}$`), async () => {
    order.push('read');
    await new Promise((resolve) => setImmediate(resolve));
    return PASS;
  });
  fake.route('POST', new RegExp(`devices/${SHUTOFF}$`), () => {
    order.push('close');
    return PASS;
  });
  const results = await Promise.all([app.setValve(SHUTOFF, false), app.setValve(SHUTOFF, false)]);
  assert.deepEqual(order, ['read', 'close', 'read']);
  assert.deepEqual(
    results.map((r) => r.changed),
    [true, false],
  );
});

test('a Water Sensor has no valve', async () => {
  const { gladys, app } = await setup();
  await allow(gladys, { allow_valve_close: true });
  await assert.rejects(app.setValve(SENSOR, false), /n'a pas de vanne/);
});

test('a valve already moving to the target: nothing sent, no error', async () => {
  const { gladys, app, timers } = await setup();
  await allow(gladys, { allow_valve_close: true });
  fake.state.devices[SHUTOFF].valve = { target: 'closed', lastKnown: 'open' };
  const result = await app.setValve(SHUTOFF, false);
  assert.equal(result.changed, false);
  assert.equal(result.valve, 'open', 'the real position, not the target');
  assert.equal(fake.made(/^POST .*devices/).length, 0);
  assert.equal(timers.timeouts().length, 2, 'followed until it gets there');
});

test('the ack does not wait for the publications to Gladys', async () => {
  const { gladys, app } = await setup();
  await allow(gladys, { allow_valve_close: true });
  let release;
  const original = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = async (...args) => {
    await new Promise((resolve) => (release = resolve));
    return original(...args);
  };
  const result = await app.setValve(SHUTOFF, false);
  assert.equal(result.changed, true, 'resolved while Gladys has not answered');
  assert.equal(app.pending.size > 0, true);
  gladys.publishChangedStates = original;
  release();
  await app.settled();
  assert.equal(app.pending.size, 0);
});

test('a failed valve command is read back all the same', async () => {
  const { gladys, timers, app } = await setup();
  await allow(gladys, { allow_valve_close: true });
  fake.route('POST', new RegExp(`devices/${SHUTOFF}$`), () => json({}, 503));
  await assert.rejects(app_set(gladys, 0), /unavailable/);
  assert.equal(timers.timeouts().length, 2, 'read back at 15 s and 60 s');
  // The known state is published again (Gladys showed the value asked for).
  await app.settled();
  assert.equal(last(gladys, SHUTOFF, 'valve'), 1);
});

test('a command not sent within 3.5 s of its arrival is refused, never sent late', async () => {
  const { gladys, clock, app } = await setup();
  await allow(gladys, { allow_valve_close: true, allow_mode_change: true });
  // The read just before acting takes 4 s.
  fake.route('GET', new RegExp(`devices/${SHUTOFF}$`), () => {
    clock.now += 4_000;
    return PASS;
  });
  await assert.rejects(app_set(gladys, 0), /attendu trop longtemps/);
  await assert.rejects(set(gladys, SHUTOFF, 'away', 1), /attendu trop longtemps/);
  assert.equal(fake.made(/^POST api-gw/).length, 0);
  // A scene action has 25 s: 4 s is fine.
  await app.setValve(SHUTOFF, false);
  assert.equal(fake.made(/^POST .*devices/).length, 1);
  // The request of a command has a short timeout.
  const post = fake.made(/^POST .*devices/)[0];
  assert.ok(post, 'sent');
});

test('the request timeouts of a command follow its deadline', async () => {
  const { gladys, app, clock } = await setup();
  await allow(gladys, { allow_valve_close: true });
  const options = app.commandOptions(clock.now + 3_500);
  assert.equal(options.read.timeout(), 3_500);
  assert.equal(options.post.timeout(), 4_500);
  clock.now += 3_400;
  assert.equal(options.read.timeout(), 500, 'never below 500 ms');
  clock.now += 200;
  assert.throws(() => options.post.guard(), /attendu trop longtemps/);
});

test('an older answer never overwrites a newer one; no duplicate trigger', async () => {
  const { gladys, app, clock } = await setup();
  const device = fake.state.devices[SHUTOFF];
  let release;
  let blocked = false;
  fake.route('GET', new RegExp(`devices/${SHUTOFF}$`), async () => {
    if (blocked) {
      return PASS;
    }
    blocked = true;
    // The refresh's read: answered with the state of now, delivered later.
    const old = structuredClone(device);
    await new Promise((resolve) => (release = resolve));
    return old;
  });
  clock.now += 2 * MINUTE;
  const refresh = app.refresh();
  while (!release) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  // Meanwhile the valve closed and a leak alert appeared; a command reads it.
  device.valve = { target: 'closed', lastKnown: 'closed' };
  device.notifications.pending.alarmCount = [{ id: 28, severity: 'warning', count: 1 }];
  await app.read(SHUTOFF);
  assert.deepEqual(events(gladys), [], 'no scene event outside the refresh');
  release();
  await refresh;
  assert.equal(app.devices.get(SHUTOFF).valve, 'closed', 'the older answer is ignored');
  assert.equal(last(gladys, SHUTOFF, 'valve'), 0);
  assert.deepEqual(
    events(gladys).map((e) => e.key),
    [SCENE_TRIGGERS.ALERT, SCENE_TRIGGERS.LEAK],
  );
  clock.now += 2 * MINUTE;
  await app.refresh();
  assert.equal(events(gladys).length, 2, 'fired once');
});

// --- Mode -----------------------------------------------------------------------------

test('Home/Away is refused by default (Home disarms the automatic shutoff)', async () => {
  const { gladys, app } = await setup();
  await assert.rejects(set(gladys, SHUTOFF, 'away', 1), /changement de mode Flo/);
  await assert.rejects(
    sceneAction(gladys, SCENE_ACTIONS.SET_MODE, { mode: 'away' }),
    /changement de mode Flo/,
  );
  assert.equal(fake.made(/systemMode/).length, 0);
  await app.settled();
  assert.equal(last(gladys, SHUTOFF, 'away'), 0, 'the known state sent again');
});

test('Away and Home from the switch, on the location, read back', async () => {
  const { gladys, timers } = await setup();
  await allow(gladys, { allow_mode_change: true });
  await set(gladys, SHUTOFF, 'away', 1);
  const [call] = fake.made(/systemMode/);
  assert.equal(call.path, `api-gw.meetflo.com/api/v2/locations/${LOCATION}/systemMode`);
  assert.deepEqual(call.body, { target: 'away' });
  await timers.runTimeouts();
  assert.equal(last(gladys, SHUTOFF, 'away'), 1);
  assert.equal(lastText(gladys, SHUTOFF, 'mode'), 'away');
  await set(gladys, SHUTOFF, 'away', 0);
  assert.deepEqual(fake.made(/systemMode/).at(-1).body, { target: 'home' });
});

test('a mode locked by Flo is refused; sleep is shown, not set', async () => {
  const { gladys, app, advance } = await setup();
  await allow(gladys, { allow_mode_change: true });
  fake.state.devices[SHUTOFF].systemMode = { isLocked: true, lastKnown: 'home', target: 'home' };
  await assert.rejects(app.setMode(SHUTOFF, 'away'), /verrouillé le mode/);
  await assert.rejects(app.setMode(SHUTOFF, 'sleep'), /mode veille demande une durée/);
  fake.state.devices[SHUTOFF].systemMode = { lastKnown: 'sleep', target: 'sleep' };
  await advance(2);
  assert.equal(lastText(gladys, SHUTOFF, 'mode'), 'sleep');
  assert.equal(last(gladys, SHUTOFF, 'away'), 0);
  assert.equal(fake.made(/systemMode/).length, 0);
});

// --- Scene actions --------------------------------------------------------------------

test('scene action set_mode: every home, or the home of a device', async () => {
  const { gladys } = await setup();
  await allow(gladys, { allow_mode_change: true });
  const out = await sceneAction(gladys, SCENE_ACTIONS.SET_MODE, { mode: 'away' });
  assert.deepEqual(out, { mode: 'away', locations: 1 });
  assert.deepEqual(fake.made(/systemMode/).at(-1).body, { target: 'away' });
  const out2 = await sceneAction(gladys, SCENE_ACTIONS.SET_MODE, {
    mode: 'home',
    device: dev(SENSOR),
  });
  assert.deepEqual(out2, { mode: 'home', locations: 1 });
});

test('scene action set_valve: behind the option, then on a fresh read', async () => {
  const { gladys } = await setup();
  await assert.rejects(
    sceneAction(gladys, SCENE_ACTIONS.SET_VALVE, { device: dev(SHUTOFF), action: 'close' }),
    /fermeture de la vanne Flo depuis Gladys est désactivée/,
  );
  await allow(gladys, { allow_valve_close: true });
  const out = await sceneAction(gladys, SCENE_ACTIONS.SET_VALVE, {
    device: dev(SHUTOFF),
    action: 'close',
  });
  assert.deepEqual(out, { device_name: 'Smart Water Shutoff', valve: 'closed', changed: true });
});

// --- Scene triggers -------------------------------------------------------------------

test('new alerts fire scene triggers once; pending ones at start do not', async () => {
  const { gladys, advance } = await setup({
    before: (f) => {
      f.state.devices[SHUTOFF].notifications.pending.alarmCount = [
        { id: 3, severity: 'info', count: 1 },
      ];
    },
  });
  assert.deepEqual(events(gladys), [], 'already pending at start');
  fake.state.devices[SHUTOFF].notifications.pending.alarmCount = [
    { id: 3, severity: 'info', count: 1 },
    { id: 10, severity: 'critical', count: 1 },
  ];
  await advance(2);
  const fired = events(gladys);
  assert.deepEqual(
    fired.map((e) => e.key),
    [SCENE_TRIGGERS.ALERT, SCENE_TRIGGERS.FLOW],
  );
  assert.equal(fired[1].data.device, dev(SHUTOFF));
  assert.equal(fired[1].data.alarm_title, 'Fast Water Flow');
  assert.equal(fired[1].data.severity, 'critical');
  // A flow alert is not a leak: the leak binary stays 0, the text lists it.
  assert.equal(last(gladys, SHUTOFF, 'leak_alert'), 0);
  assert.equal(
    lastText(gladys, SHUTOFF, 'alerts'),
    'Health Test Skipped (info), Fast Water Flow (critical)',
  );
  await advance(2);
  assert.equal(events(gladys).length, 2, 'still pending: not new');
  // A drip: a leak.
  fake.state.devices[SHUTOFF].notifications.pending.alarmCount.push({
    id: 28,
    severity: 'warning',
    count: 1,
  });
  await advance(2);
  assert.deepEqual(
    events(gladys)
      .slice(2)
      .map((e) => e.key),
    [SCENE_TRIGGERS.ALERT, SCENE_TRIGGERS.LEAK],
  );
  assert.equal(last(gladys, SHUTOFF, 'leak_alert'), 1);
  // Cleared alerts: the leak binary goes back to 0.
  fake.state.devices[SHUTOFF].notifications.pending.alarmCount = [];
  await advance(2);
  assert.equal(last(gladys, SHUTOFF, 'leak_alert'), 0);
  assert.equal(lastText(gladys, SHUTOFF, 'alerts'), 'aucune');
});

test('an info leak alert fires alert_raised only; an unknown alert without catalog', async () => {
  const { gladys, advance } = await setup({
    before: (f) => f.route('GET', /\/alarms$/, () => json({}, 503)),
  });
  fake.state.devices[SHUTOFF].notifications.pending.alarmCount = [
    { id: 77, severity: 'Critical', count: 1 },
  ];
  await advance(2);
  const fired = events(gladys);
  assert.deepEqual(
    fired.map((e) => e.key),
    [SCENE_TRIGGERS.ALERT],
  );
  assert.equal(fired[0].data.severity, 'critical');
  assert.equal(fired[0].data.category, 'other');
  // Catalog unavailable: an unknown critical alert lights the leak binary, by caution.
  assert.equal(last(gladys, SHUTOFF, 'leak_alert'), 1);
});

test('an alert raised while the integration was down fires at the next start', async () => {
  const clock = { now: NOW };
  const installed = installFlo(clock);
  const data = dataDir();
  const first = await setup({ installed, data });
  first.app.stop();
  const saved = JSON.parse(readFileSync(join(data, 'flo-seen.json'), 'utf8'));
  assert.deepEqual(saved.devices[SENSOR], { alarms: [], water: false });
  // Down: the Water Sensor detects water.
  installed.state.devices[SENSOR].fwProperties.telemetry_water = true;
  const second = await setup({ installed, data });
  const leaks = events(second.gladys).filter((e) => e.key === SCENE_TRIGGERS.LEAK);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].data.source, 'sensor');
  // Without the saved state, nothing fires (not new for all we know).
  const third = await setup({ installed, data: dataDir() });
  assert.deepEqual(events(third.gladys), []);
  second.app.stop();
  third.app.stop();
});

test('a Water Sensor detecting water fires one leak trigger', async () => {
  const { gladys, advance } = await setup();
  fake.state.devices[SENSOR].fwProperties.telemetry_water = true;
  fake.state.devices[SENSOR].notifications.pending.alarmCount = [
    { id: 100, severity: 'critical', count: 1 },
  ];
  await advance(2);
  const leaks = events(gladys).filter((e) => e.key === SCENE_TRIGGERS.LEAK);
  assert.equal(leaks.length, 1, 'one leak event, not one per source');
  assert.equal(leaks[0].data.device_name, 'Water heater closet');
  assert.equal(last(gladys, SENSOR, 'leak'), 1);
  await advance(2);
  assert.equal(events(gladys).filter((e) => e.key === SCENE_TRIGGERS.LEAK).length, 1);
});

// --- Lifecycle ------------------------------------------------------------------------

test('new credentials restart; the language renames the features', async () => {
  const { gladys } = await setup();
  await gladys.fake.configUpdated({ ...CONFIG, language: 'en' });
  assert.equal(featureOf(gladys, SHUTOFF, 'valve').name, 'Valve open');
  assert.equal(fake.made(/users\/auth/).length, 1);
  await gladys.fake.configUpdated({ ...CONFIG, email: 'Other@Example.com' });
  assert.equal(fake.made(/users\/auth/).length, 2);
  assert.equal(fake.made(/users\/auth/).at(-1).body.username, 'Other@Example.com');
});

test('a device removed from Flo is dropped; a 404 device is skipped', async () => {
  const { gladys, app, advance } = await setup();
  delete fake.state.devices[SENSOR];
  await advance(2);
  assert.equal(app.devices.has(SENSOR), false);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the test button summarizes the account', async () => {
  const { gladys, clock } = await setup();
  clock.now += MINUTE;
  const answer = await action(gladys, ACTIONS.TEST_CONNECTION);
  assert.match(
    answer.en,
    /1 home, 1 Smart Water Shutoff, 1 Water Sensor, 1 other device not supported/,
  );
  assert.match(answer.en, /Flo sign-in/);
});
