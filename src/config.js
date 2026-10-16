// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { LOGIN_METHODS, REFRESH_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  login_method: LOGIN_METHODS.AUTO,
  refresh_interval: REFRESH_INTERVAL.default,
  // Louis's rule: a valve is never opened nor closed until the user allows it.
  allow_valve_open: false,
  allow_valve_close: false,
  // Home disarms Flo's automatic shutoff of Away: off too — PROVISIONAL,
  // pending Louis's decision (see TODO.md).
  allow_mode_change: false,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A checkbox may arrive as a boolean or as a string from a form; absent = its default. */
const flag = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value === true || value === 'true' || value === 1 || value === '1';
};

export function normalizeConfig(raw = {}) {
  const given = raw?.refresh_interval;
  const interval = given === undefined || given === null || given === '' ? NaN : Number(given);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const method = String(raw?.login_method ?? DEFAULTS.login_method)
    .trim()
    .toLowerCase();
  return {
    email: String(raw?.email ?? '').trim(),
    // Never trimmed: a password may end with a space.
    password: String(raw?.password ?? ''),
    loginMethod: Object.values(LOGIN_METHODS).includes(method) ? method : DEFAULTS.login_method,
    refreshInterval: Number.isFinite(interval)
      ? Math.round(Math.max(REFRESH_INTERVAL.min, Math.min(REFRESH_INTERVAL.max, interval)))
      : DEFAULTS.refresh_interval,
    allowValveOpen: flag(raw?.allow_valve_open, DEFAULTS.allow_valve_open),
    allowValveClose: flag(raw?.allow_valve_close, DEFAULTS.allow_valve_close),
    allowModeChange: flag(raw?.allow_mode_change, DEFAULTS.allow_mode_change),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
