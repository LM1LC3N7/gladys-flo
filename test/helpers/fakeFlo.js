// -----------------------------------------------------------------------------
// A fake Flo cloud behind `fetch` (src/http.js setFetch): both sign-in flows,
// the account, the devices, the commands, the consumption and the alarm
// catalog, from the fixtures. Every call is recorded; an unexpected one fails
// loudly. No test touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake Flo in a test: ${url}`);
});

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/** 2026-10-13T05:00:00Z (01:00 in Boston), the instant the tests start at. */
export const NOW = Date.parse('2026-10-13T05:00:00Z');
export const MINUTE = 60_000;
export const EMAIL = 'email@address.com';
export const PASSWORD = 'pa55-w0rd';
export const USER_ID = '12345abcde';
export const SHUTOFF = '5f1c0a9e-shutoff-0001';
export const SENSOR = '7a2d4c1b-sensor-0002';
export const BRIDGE = '9b9b9b9b-bridge-0003';
export const LOCATION = 'loc-home-1';

export const json = (body, status = 200, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Handlers return PASS to hand the request to the default route. */
export const PASS = Symbol('pass');

/**
 * Installs the fake. `clock.now` dates the tokens. Returns `{ state, calls,
 * route(method, pattern, handler), restore }`; `state` is editable by the test.
 */
export function installFlo(clock) {
  const state = {
    user: fixture('user.json'),
    devices: {
      [SHUTOFF]: fixture('device-shutoff.json'),
      [SENSOR]: fixture('device-sensor.json'),
      [BRIDGE]: { id: BRIDGE, deviceType: 'flo_bridge', nickname: 'Bridge', isConnected: true },
    },
    alarms: fixture('alarms.json'),
    consumption: fixture('consumption.json'),
    /** "ok" | "refuse" | "gone" (404: the legacy endpoint retired) */
    floAuth: 'ok',
    /** "ok" | "refuse" */
    moenAuth: 'ok',
    /** Token lifetime given by the legacy sign-in, in seconds. */
    tokenExpiration: 86400,
    /** Tokens the API accepts. */
    valid: new Set(),
    issued: 0,
    /** What the valve does after a command: "follow" (moves at once) or "stay". */
    valveBehaviour: 'stay',
  };
  const calls = [];
  const overrides = [];
  const issue = (prefix) => {
    state.issued += 1;
    const token = `${prefix}-${state.issued}`;
    state.valid.add(token);
    return token;
  };
  const authorized = (call) => {
    const header = call.headers.Authorization ?? '';
    return state.valid.has(header.replace(/^Bearer /, ''));
  };
  const routes = [
    [
      'POST',
      /^api\.meetflo\.com\/api\/v1\/users\/auth$/,
      ({ body }) => {
        if (state.floAuth === 'gone') {
          return json({ error: 'not found' }, 404);
        }
        if (state.floAuth === 'refuse' || body.username !== EMAIL || body.password !== PASSWORD) {
          return json({ error: true, message: 'Invalid username or password' }, 401);
        }
        return {
          token: issue('flo'),
          tokenPayload: {
            user: { user_id: USER_ID, email: EMAIL },
            timestamp: Math.floor(clock.now / 1000),
          },
          tokenExpiration: state.tokenExpiration,
          timeNow: Math.floor(clock.now / 1000),
        };
      },
    ],
    [
      'POST',
      /execute-api\.us-east-2\.amazonaws\.com\/prod\/v1\/oauth2\/token$/,
      ({ body }) => {
        if (body.client_id !== '6qn9pep31dglq6ed4fvlq6rp5t') {
          return json({ message: 'bad client' }, 400);
        }
        if (body.grant_type === 'refresh_token') {
          if (!state.valid.has(body.refresh_token)) {
            return json({ message: 'refresh refused' }, 400);
          }
          return { token: { access_token: issue('moen'), token_type: 'Bearer', expires_in: 3600 } };
        }
        if (state.moenAuth === 'refuse' || body.username !== EMAIL || body.password !== PASSWORD) {
          return json({ message: 'Incorrect username or password.' }, 401);
        }
        return {
          token: {
            access_token: issue('moen'),
            refresh_token: issue('refresh'),
            token_type: 'Bearer',
            expires_in: 3600,
          },
        };
      },
    ],
    ['GET', /\/api\/v2\/users\/me$/, () => ({ id: USER_ID, email: EMAIL })],
    ['GET', /\/api\/v2\/users\/[^/]+$/, () => state.user],
    ['GET', /\/api\/v2\/alarms$/, () => state.alarms],
    ['GET', /\/api\/v2\/water\/consumption$/, () => state.consumption],
    [
      'GET',
      /\/api\/v2\/devices\/[^/]+$/,
      ({ path }) => state.devices[path.split('/').at(-1)] ?? json({ error: 'not found' }, 404),
    ],
    [
      'POST',
      /\/api\/v2\/devices\/[^/]+$/,
      ({ path, body }) => {
        const device = state.devices[path.split('/').at(-1)];
        if (!device) {
          return json({ error: 'not found' }, 404);
        }
        device.valve = {
          target: body.valve.target,
          lastKnown: state.valveBehaviour === 'follow' ? body.valve.target : device.valve.lastKnown,
        };
        return device;
      },
    ],
    [
      'POST',
      /\/api\/v2\/locations\/[^/]+\/systemMode$/,
      ({ body }) => {
        for (const device of Object.values(state.devices)) {
          if (device.systemMode) {
            device.systemMode = {
              ...device.systemMode,
              target: body.target,
              lastKnown: body.target,
            };
          }
        }
        return undefined;
      },
    ],
  ];
  const previous = setFetch(async (url, init = {}) => {
    const u = new URL(url);
    const call = {
      url,
      method: init.method ?? 'GET',
      path: `${u.host}${u.pathname}`,
      query: Object.fromEntries(u.searchParams),
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers ?? {},
    };
    calls.push(call);
    for (const [method, pattern, handler] of overrides) {
      if (method === call.method && pattern.test(call.path)) {
        const answer = await handler(call);
        if (answer !== PASS) {
          return answer instanceof Response ? answer : json(answer);
        }
      }
    }
    const signIn = /users\/auth$|oauth2\/token$/.test(call.path);
    if (!signIn && !authorized(call)) {
      return json({ error: true, message: 'Unauthorized' }, 401);
    }
    for (const [method, pattern, handler] of routes) {
      if (method === call.method && pattern.test(call.path)) {
        const answer = await handler(call);
        if (answer instanceof Response) {
          return answer;
        }
        return answer === undefined ? new Response(null, { status: 204 }) : json(answer);
      }
    }
    throw new Error(`Unexpected network call in a test: ${call.method} ${url}`);
  });
  return {
    state,
    calls,
    route: (method, pattern, handler) => overrides.unshift([method, pattern, handler]),
    /** The calls whose "METHOD host/path" matches. */
    made: (pattern) => calls.filter((c) => pattern.test(`${c.method} ${c.path}`)),
    restore: () => setFetch(previous),
  };
}

/** Fake timers: nothing fires by itself, the test runs what it wants. */
export function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const add = (kind, fn, ms) => {
    const id = nextId++;
    pending.set(id, { id, kind, fn, ms });
    return id;
  };
  return {
    pending,
    setTimeout: (fn, ms) => add('timeout', fn, ms),
    setInterval: (fn, ms) => add('interval', fn, ms),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    timeouts: () => [...pending.values()].filter((t) => t.kind === 'timeout'),
    intervals: () => [...pending.values()].filter((t) => t.kind === 'interval'),
    async runTimeouts() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'timeout')) {
        pending.delete(t.id);
        await t.fn();
      }
    },
    async runIntervals() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'interval')) {
        await t.fn();
      }
    },
  };
}
