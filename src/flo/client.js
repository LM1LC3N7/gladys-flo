// -----------------------------------------------------------------------------
// The Flo cloud client: sign-in, the access token kept fresh, and the calls
// the integration needs, as raw JSON (src/flo/model.js reads it).
//
// Ported from aioflo (MIT, https://github.com/bachya/aioflo), api.py:
// - "flo": the legacy sign-in, POST api.meetflo.com/api/v1/users/auth with the
//   e-mail and password; the token goes as is in `Authorization`, and carries
//   the user id and its lifetime (`tokenPayload.timestamp + tokenExpiration`).
// - "moen": the Moen SSO (Cognito) of the current Moen Smartwater app; a
//   bearer token, a refresh token, the user id from /users/me.
// - "auto" (default): Flo first, Moen when Flo refuses or no longer exists.
//
// The token is renewed TIMINGS.tokenMargin before it expires, and once when
// the API refuses it; a refused sign-in is never retried by itself. Tokens
// and the password stay in memory, and never reach a log or an error message.
// -----------------------------------------------------------------------------

import { API, LOGIN_METHODS, TIMINGS } from '../constants.js';
import { HttpError, NetworkError, request } from '../http.js';

/**
 * A failed Flo call. `kind`:
 * - `no_credentials`: no e-mail or password configured (nothing sent);
 * - `refused`: the sign-in was refused (wrong e-mail or password);
 * - `unauthorized`: the API refused the token, even a fresh one;
 * - `rate_limited`: HTTP 429 (`retryAfter` in ms when Flo gave one);
 * - `unavailable`: 5xx, or a 403 of the CloudFront front end (not the account);
 * - `not_found`: 404/410 (a device removed, or a retired endpoint);
 * - `network`, `timeout`: no answer; `bad_response`: not the expected JSON;
 * - `http`: any other status.
 */
export class FloError extends Error {
  constructor(kind, message, { status, retryAfter } = {}) {
    super(message);
    this.name = 'FloError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Retry-After: seconds or an HTTP date -> milliseconds, undefined when absent or unreadable. */
export function retryAfterOf(headers, now = Date.now()) {
  const value = headers?.get?.('retry-after');
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** A 403 of the CloudFront front end (a block or an outage), not a refusal of the account. */
function fromCloudFront(err) {
  const header = (name) => String(err.headers?.get?.(name) ?? '').toLowerCase();
  return (
    header('x-cache').includes('cloudfront') ||
    header('server').includes('cloudfront') ||
    /cloudfront/i.test(err.text ?? '')
  );
}

/** An HttpError / NetworkError -> FloError. `signIn`: the answer of a sign-in endpoint. */
export function floError(err, { signIn = false, now = Date.now() } = {}) {
  if (err instanceof FloError) {
    return err;
  }
  if (err instanceof NetworkError) {
    return new FloError(err.kind, err.message);
  }
  if (!(err instanceof HttpError)) {
    return new FloError('network', String(err?.message ?? err));
  }
  const { status } = err;
  if (status === 429) {
    return new FloError('rate_limited', 'Flo asks to slow down', {
      status,
      retryAfter: retryAfterOf(err.headers, now),
    });
  }
  if (status >= 500 || (status === 403 && fromCloudFront(err))) {
    return new FloError('unavailable', `Flo is unavailable (${err.message})`, { status });
  }
  if (status === 404 || status === 410) {
    return new FloError('not_found', err.message, { status });
  }
  if (signIn && [400, 401, 403].includes(status)) {
    return new FloError('refused', 'e-mail or password refused', { status });
  }
  if (status === 401 || status === 403) {
    return new FloError('unauthorized', 'access token refused', { status });
  }
  return new FloError('http', err.message, { status });
}

/** Sign-in failures after which the other flow is worth a try ("auto"). */
const TRY_OTHER = new Set(['refused', 'not_found']);

export class FloClient {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.email = '';
    this.password = '';
    this.loginMethod = LOGIN_METHODS.AUTO;
    /** { method, token, expiresAt, refreshToken?, userId } | null — memory only. */
    this.session = null;
    /** The flow that worked last ("auto"): tried first next time. */
    this.preferred = undefined;
    this.renewing = undefined;
    /** Bumped by configure(): a session asked for older credentials is dropped. */
    this.generation = 0;
    /** Requests sent (the tests and the status use it). */
    this.calls = 0;
  }

  configure({ email, password, loginMethod }) {
    this.email = email;
    this.password = password;
    this.loginMethod = loginMethod;
    this.session = null;
    this.preferred = undefined;
    this.generation += 1;
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  /** The sign-in flow in use ("flo" or "moen"), once signed in. */
  get method() {
    return this.session?.method;
  }

  get userId() {
    return this.session?.userId;
  }

  async send(url, options, { signIn = false } = {}) {
    this.calls += 1;
    try {
      return (await request(url, options)).data;
    } catch (err) {
      throw floError(err, { signIn, now: this.now() });
    }
  }

  // --- Sign-in -----------------------------------------------------------------

  async loginFlo() {
    const data = await this.send(
      API.LEGACY_AUTH_URL,
      { method: 'POST', body: { username: this.email, password: this.password } },
      { signIn: true },
    );
    const token = data?.token;
    const userId = data?.tokenPayload?.user?.user_id;
    if (typeof token !== 'string' || token === '' || !userId) {
      throw new FloError('bad_response', 'Flo sent no token');
    }
    const end = (Number(data.tokenPayload.timestamp) + Number(data.tokenExpiration)) * 1000;
    return {
      method: LOGIN_METHODS.FLO,
      token,
      expiresAt:
        Number.isFinite(end) && end > this.now() ? end : this.now() + TIMINGS.tokenLifetime,
      userId: String(userId),
    };
  }

  /** POST to the SSO token endpoint: `{ token: {...} }`, or the token object itself. */
  async ssoToken(payload) {
    const data = await this.send(
      API.SSO_TOKEN_URL,
      { method: 'POST', body: { ...payload, client_id: API.SSO_CLIENT_ID } },
      { signIn: true },
    );
    const token = data?.token && typeof data.token === 'object' ? data.token : data;
    if (typeof token?.access_token !== 'string' || token.access_token === '') {
      throw new FloError('bad_response', 'Moen sent no access token');
    }
    const seconds = Number(token.expires_in);
    return {
      token: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : undefined,
      expiresAt: this.now() + (seconds > 0 ? seconds * 1000 : TIMINGS.tokenLifetime),
    };
  }

  async loginMoen() {
    const token = await this.ssoToken({ username: this.email, password: this.password });
    // Unlike the Flo token, the SSO token does not carry the user id.
    const me = await this.send(`${API.V2}/users/me`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    if (!me?.id) {
      throw new FloError('bad_response', 'Moen sent no user id');
    }
    return { method: LOGIN_METHODS.MOEN, ...token, userId: String(me.id) };
  }

  async login() {
    const flows =
      this.loginMethod === LOGIN_METHODS.FLO
        ? [LOGIN_METHODS.FLO]
        : this.loginMethod === LOGIN_METHODS.MOEN
          ? [LOGIN_METHODS.MOEN]
          : this.preferred === LOGIN_METHODS.MOEN
            ? [LOGIN_METHODS.MOEN, LOGIN_METHODS.FLO]
            : [LOGIN_METHODS.FLO, LOGIN_METHODS.MOEN];
    let failure;
    for (const flow of flows) {
      try {
        const session = flow === LOGIN_METHODS.FLO ? await this.loginFlo() : await this.loginMoen();
        this.preferred = flow;
        return session;
      } catch (err) {
        // A passing failure (network, 5xx, 429) is not a reason to try the other flow.
        if (!TRY_OTHER.has(err.kind)) {
          throw err;
        }
        failure = failure?.kind === 'refused' ? failure : err;
      }
    }
    // Both flows refused, or the only one: the credentials are wrong.
    throw failure.kind === 'not_found'
      ? new FloError('refused', 'no sign-in endpoint accepted the account', { status: 404 })
      : failure;
  }

  /** A new session; one renewal at a time, the other calls wait for it. */
  renew() {
    if (!this.hasCredentials) {
      return Promise.reject(new FloError('no_credentials', 'no e-mail or password'));
    }
    if (!this.renewing) {
      const generation = this.generation;
      const previous = this.session;
      const run = async () => {
        if (previous?.method === LOGIN_METHODS.MOEN && previous.refreshToken) {
          try {
            const token = await this.ssoToken({
              grant_type: 'refresh_token',
              refresh_token: previous.refreshToken,
            });
            // A refresh answer may omit the refresh token: keep the one we have.
            return {
              ...previous,
              ...token,
              refreshToken: token.refreshToken ?? previous.refreshToken,
            };
          } catch (err) {
            if (!['refused', 'unauthorized', 'http', 'bad_response'].includes(err.kind)) {
              throw err; // passing failure: the refresh token is kept for the next try
            }
            // The refresh token is refused: one full sign-in, never a loop.
          }
        }
        return this.login();
      };
      this.renewing = run()
        .then((session) => {
          if (generation === this.generation) {
            this.session = session;
          }
          return session;
        })
        .finally(() => {
          this.renewing = undefined;
        });
    }
    return this.renewing;
  }

  needsToken() {
    return !this.session || this.now() >= this.session.expiresAt - TIMINGS.tokenMargin;
  }

  async ensureSession() {
    if (this.needsToken()) {
      await this.renew();
    }
    return this.session;
  }

  authorization(session) {
    return session.method === LOGIN_METHODS.MOEN ? `Bearer ${session.token}` : session.token;
  }

  /** One API call; a refused token is renewed once and the call retried once. */
  async call(path, { method = 'GET', body, query } = {}) {
    const session = await this.ensureSession();
    const options = (s) => ({
      method,
      body,
      query,
      headers: { Authorization: this.authorization(s) },
    });
    try {
      return await this.send(`${API.V2}${path}`, options(session));
    } catch (err) {
      if (err.kind !== 'unauthorized') {
        throw err;
      }
      if (this.session === session) {
        // Expired early (password changed elsewhere...): renew now.
        this.session = { ...session, expiresAt: 0 };
      }
      const fresh = await this.ensureSession();
      return this.send(`${API.V2}${path}`, options(fresh));
    }
  }

  // --- Calls -------------------------------------------------------------------

  /** The user with its locations and their device ids (aioflo `user.get_info`). */
  async account() {
    await this.ensureSession();
    return this.call(`/users/${encodeURIComponent(this.userId)}`, {
      query: { expand: 'locations' },
    });
  }

  /** One device, with its telemetry, valve, mode and pending alerts. */
  device(deviceId) {
    return this.call(`/devices/${encodeURIComponent(deviceId)}`);
  }

  /** `target`: "open" or "closed" (aioflo `open_valve` / `close_valve`). */
  setValve(deviceId, target) {
    return this.call(`/devices/${encodeURIComponent(deviceId)}`, {
      method: 'POST',
      body: { valve: { target } },
    });
  }

  /** `mode`: "home" or "away" (aioflo `set_mode_home` / `set_mode_away`). */
  setMode(locationId, mode) {
    return this.call(`/locations/${encodeURIComponent(locationId)}/systemMode`, {
      method: 'POST',
      body: { target: mode },
    });
  }

  /** Hourly consumption of one shutoff over a local day (aioflo `get_consumption_info`). */
  consumption({ locationId, macAddress, startDate, endDate }) {
    return this.call('/water/consumption', {
      query: {
        startDate,
        endDate,
        interval: '1h',
        locationId,
        ...(macAddress ? { macAddress: String(macAddress).replaceAll(':', '') } : {}),
      },
    });
  }

  /** The alarm catalog: id, name, severity (aioflo `alarm.get_all`). */
  alarms() {
    return this.call('/alarms');
  }
}
