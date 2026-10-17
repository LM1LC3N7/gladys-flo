// -----------------------------------------------------------------------------
// Manifest keys, Flo cloud endpoints, limits and timings.
//
// The endpoints, the two sign-in flows and the shape of the answers come from
// aioflo (MIT, https://github.com/bachya/aioflo), the Python client of the
// Home Assistant "Flo" integration, ported to JavaScript here.
// -----------------------------------------------------------------------------

export const API = {
  /** Legacy Flo sign-in (aioflo `API_V1_BASE` + `users/auth`). */
  LEGACY_AUTH_URL: 'https://api.meetflo.com/api/v1/users/auth',
  /** Moen SSO (Cognito) token endpoint, the one of the current Moen Smartwater app. */
  SSO_TOKEN_URL: 'https://4j1gkf0vji.execute-api.us-east-2.amazonaws.com/prod/v1/oauth2/token',
  /** Public client id of the Moen app (aioflo `SSO_CLIENT_ID`, not a secret). */
  SSO_CLIENT_ID: '6qn9pep31dglq6ed4fvlq6rp5t',
  /** Every other call (aioflo `API_V2_BASE`). */
  V2: 'https://api-gw.meetflo.com/api/v2',
  /** Headers aioflo sends (the Flo web app's). */
  ORIGIN: 'https://user.meetflo.com',
  REFERER: 'https://user.meetflo.com/home',
};

/** The sign-in flows of the `login_method` option. */
export const LOGIN_METHODS = {
  AUTO: 'auto',
  FLO: 'flo',
  MOEN: 'moen',
};

/** Flo `deviceType` values. */
export const DEVICE_TYPES = {
  SHUTOFF: 'flo_device_v2',
  SENSOR: 'puck_oem',
};

/** Flo system modes (aioflo `location.py`). Sleep needs a duration: not settable here. */
export const MODES = {
  HOME: 'home',
  AWAY: 'away',
  SLEEP: 'sleep',
};

/** Valve states the API reports (`valve.lastKnown`). */
export const VALVE = {
  OPEN: 'open',
  CLOSED: 'closed',
};

/**
 * A water temperature at or above boiling is the placeholder of a shutoff
 * without a temperature sensor (aioflo `IMPLAUSIBLE_WATER_TEMP_F`).
 */
export const IMPLAUSIBLE_WATER_TEMP_F = 212;

/** Gladys values (server/utils/constants.js of the core, not exported by the SDK). */
export const GLADYS = {
  ON: 1,
  OFF: 0,
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const SCENE_ACTIONS = {
  SET_MODE: 'set_mode',
  SET_VALVE: 'set_valve',
};

export const SCENE_TRIGGERS = {
  LEAK: 'leak_detected',
  FLOW: 'abnormal_flow',
  ALERT: 'alert_raised',
};

/** The families of Flo alerts, by the name of the alarm (see src/flo/model.js). */
export const ALERT_CATEGORIES = {
  LEAK: 'leak',
  FLOW: 'flow',
  OTHER: 'other',
};

export const SEVERITIES = ['critical', 'warning', 'info'];

/** Refresh of every device, in minutes. */
export const REFRESH_INTERVAL = { min: 1, max: 60, default: 2 };

export const TIMINGS = {
  requestTimeout: 15_000,
  /** The loop looks every minute whether a read is due. */
  tickInterval: 60_000,
  /** Today's consumption is read at most this often per shutoff. */
  consumptionInterval: 15 * 60_000,
  /** The alarm names (to sort alerts into leak / flow / other) are read once a day. */
  catalogInterval: 24 * 60 * 60_000,
  /** An unchanged state is sent again every 30 minutes. */
  stateHeartbeat: 30 * 60_000,
  /** Renew the token this long before it expires (aioflo keeps 60 s; more is safer). */
  tokenMargin: 5 * 60_000,
  /** A token younger than this is never renewed because a call was refused. */
  tokenMinAge: 60_000,
  /** A device Flo refuses (401/403 after renewal) is not asked again for this long. */
  forbiddenDevicePause: 60 * 60_000,
  /** Token lifetime when the answer gives none (aioflo assumes 1 h for SSO). */
  tokenLifetime: 60 * 60_000,
  /** Pauses after a failed refresh: 1, 2, 5, 10 then 15 minutes. */
  backoff: [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000],
  /** After a 429: its Retry-After between these bounds, 5 minutes without one. */
  rateLimitMin: 60_000,
  rateLimitMax: 60 * 60_000,
  rateLimitDefault: 5 * 60_000,
  /**
   * A command must reach Flo before Gladys stops waiting for its answer:
   * set_value is acked within 5 s (refused if not sent within 3.5 s of its
   * arrival), a scene action within its timeout_seconds (30 s; 25 s here).
   */
  setValueDeadline: 3_500,
  sceneActionDeadline: 25_000,
  /** Network timeout of a request of a command: what is left of the deadline, within these bounds. */
  commandTimeoutMin: 500,
  commandTimeoutMax: 10_000,
  /** The command POST may run this long past the deadline (the ack still fits in 5 s). */
  commandPostSlack: 1_000,
  /** After a valve or mode command, the device is read back after these delays. */
  readBack: [15_000, 60_000],
  /** The test button and the Discovery scan read Flo at most this often. */
  testCooldown: 30_000,
};

export const LIMITS = {
  /** Largest answer read (a device answer is about 10 KB). */
  responseBytes: 2 * 1024 * 1024,
};

/**
 * The User-Agent aioflo (and so Home Assistant) sends: the Flo API is only
 * known to answer this one, kept as is rather than risk a refusal.
 */
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36';

/** Conversions (US units -> the units Gladys lists for each category). */
export const CONVERT = {
  /** gallons per minute -> cubic metres per hour */
  gpmToM3h: (gpm) => gpm * 0.227124707,
  /** gallons -> litres */
  galToL: (gal) => gal * 3.785411784,
  /** Fahrenheit -> Celsius */
  fToC: (f) => ((f - 32) * 5) / 9,
};
