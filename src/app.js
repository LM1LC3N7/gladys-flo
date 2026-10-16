// -----------------------------------------------------------------------------
// The integration: the Flo account, a refresh of every device at start and
// every `refresh_interval` minutes, the Gladys devices and their states, the
// scene triggers on new alerts, the commands (valve, Home/Away) and the
// badges. index.js only wires the SDK handlers to it (src/handlers.js).
//
// Valve safety (Louis's rule, not negotiable): opening and closing are off
// until the user allows each of them; the commands of one device run one at
// a time; the device is read again just before acting, and the command is
// refused when that read fails or the valve is offline, moving or unknown.
// A state kept in memory never decides a valve command.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { MODES, TIMINGS, VALVE } from './constants.js';
import { buildDevice, deviceIds, deviceName, parseExternalId, statesOf } from './devices.js';
import { FloClient } from './flo/client.js';
import {
  catalogOf,
  consumptionOf,
  localDay,
  locationsOf,
  readingOf,
  valveAtRest,
} from './flo/model.js';
import { T, age, word } from './i18n.js';
import { alertEvents } from './triggers.js';

/** Errors after which only a change of the configuration (or the test button) helps. */
const REFUSED = new Set(['refused', 'no_credentials']);
/** Errors meaning Flo did not answer usefully: the devices are unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'http']);

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

export class FloApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'flo' }),
    now = Date.now,
    timers = defaultTimers,
    client,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.client = client ?? new FloClient({ now });
    this.config = normalizeConfig();
    this.generation = 0;
    this.tickTimer = undefined;
    this.running = undefined;
    this.started = false;
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    /** key -> tail of its command chain: one valve / mode command at a time. */
    this.chains = new Map();
    this.readBackTimers = new Set();
    this.reset();
  }

  /** Forgets the account and the failures: new credentials, or a restart. */
  reset() {
    /** Flo device id -> last reading (supported devices only) */
    this.devices = new Map();
    /** Flo location id -> location of src/flo/model.js */
    this.locations = new Map();
    /** Flo device id -> location id, from the account */
    this.locationOf = new Map();
    this.skipped = [];
    /** shutoff id -> { day, gallons, at } */
    this.gallons = new Map();
    this.catalog = new Map();
    this.catalogAt = -Infinity;
    this.readAt = undefined;
    this.nextRefreshAt = 0;
    this.pausedUntil = 0;
    this.failures = 0;
    this.refused = false;
    this.offline = false;
    this.published = undefined;
    /** device external id -> badge last published (JSON) */
    this.transports = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.client.configure({
      email: this.config.email,
      password: this.config.password,
      loginMethod: this.config.loginMethod,
    });
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    await this.setStatus(false, T.connecting);
    this.tickTimer = this.timers.setInterval(() => {
      this.tick().catch((err) => this.logger.error(`Flo refresh failed: ${err.message}`));
    }, TIMINGS.tickInterval);
    await this.refresh();
  }

  stop() {
    this.generation += 1;
    if (this.tickTimer) {
      this.timers.clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    for (const timer of this.readBackTimers) {
      this.timers.clearTimeout(timer);
    }
    this.readBackTimers.clear();
  }

  /** First connection: start. A reconnection (Gladys restarted): resend what Gladys forgot. */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.transports.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishTransports();
  }

  /** New credentials restart; a new language renames; the rest applies at once. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (
      next.email !== previous.email ||
      next.password !== previous.password ||
      next.loginMethod !== previous.loginMethod
    ) {
      return this.start(raw);
    }
    this.config = next;
    if (next.refreshInterval !== previous.refreshInterval && this.readAt !== undefined) {
      this.nextRefreshAt = this.readAt + next.refreshInterval * 60_000;
    }
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Refresh ---------------------------------------------------------------

  /** Every minute: a refresh when one is due. */
  async tick() {
    if (this.now() >= this.nextRefreshAt && this.now() >= this.pausedUntil) {
      await this.refresh();
    }
  }

  /** One refresh at a time: a call during a refresh joins it. */
  refresh() {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async run() {
    const generation = this.generation;
    if (!this.client.hasCredentials || this.refused) {
      return;
    }
    // The new alerts already read are fired even if a later read fails:
    // their reading is kept, they would not be "new" at the next refresh.
    const events = [];
    try {
      const locations = locationsOf(await this.client.account());
      await this.readCatalog();
      const seen = new Set();
      const skipped = [];
      for (const location of locations) {
        for (const { id } of location.devices) {
          if (generation !== this.generation) {
            return;
          }
          this.locationOf.set(id, location.id);
          let reading;
          try {
            reading = readingOf(await this.client.device(id));
          } catch (err) {
            if (err.kind !== 'not_found') {
              throw err;
            }
            this.logger.info(`Flo device ${id} not found: skipped`);
            continue;
          }
          reading.id ||= id;
          reading.locationId ??= location.id;
          if (reading.kind === 'other') {
            skipped.push({ id, type: reading.type });
            continue;
          }
          seen.add(reading.id);
          if (reading.kind === 'shutoff') {
            await this.readConsumption(reading, location);
          }
          events.push(...this.update(reading));
        }
      }
      if (generation !== this.generation) {
        return;
      }
      this.locations = new Map(locations.map((l) => [l.id, l]));
      for (const id of [...this.devices.keys()]) {
        if (!seen.has(id)) {
          this.devices.delete(id);
          this.gallons.delete(id);
        }
      }
      this.skipped = skipped;
      this.readAt = this.now();
      this.nextRefreshAt = this.readAt + this.config.refreshInterval * 60_000;
      this.failures = 0;
      this.offline = false;
      await this.publishDevices();
      await this.publishStates();
      await this.setStatus(true, T.connected(this.devices.size, this.skipped.length));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    }
    await this.publishEvents(events);
    await this.publishTransports();
  }

  /** The alarm names, once a day; best effort (the alerts then fall back to their severity). */
  async readCatalog() {
    if (this.now() - this.catalogAt < TIMINGS.catalogInterval) {
      return;
    }
    try {
      this.catalog = catalogOf(await this.client.alarms());
      this.catalogAt = this.now();
    } catch (err) {
      if (REFUSED.has(err.kind) || err.kind === 'rate_limited') {
        throw err;
      }
      // Tried again in an hour.
      this.catalogAt = this.now() - TIMINGS.catalogInterval + 60 * 60_000;
      this.logger.info(`Flo alarm names unavailable: ${err.message}`);
    }
  }

  /** Today's consumption of a shutoff, every 15 minutes and at each new local day. */
  async readConsumption(reading, location) {
    const today = localDay(this.now(), location.timezone);
    const entry = this.gallons.get(reading.id);
    if (entry && entry.day === today.day && this.now() - entry.at < TIMINGS.consumptionInterval) {
      return;
    }
    try {
      const gallons = consumptionOf(
        await this.client.consumption({
          locationId: location.id,
          macAddress: reading.macAddress,
          startDate: today.startDate,
          endDate: today.endDate,
        }),
      );
      this.gallons.set(reading.id, { day: today.day, gallons, at: this.now() });
    } catch (err) {
      if (REFUSED.has(err.kind) || err.kind === 'rate_limited') {
        throw err;
      }
      this.logger.info(`Flo consumption unavailable: ${err.message}`);
      if (entry && entry.day !== today.day) {
        this.gallons.delete(reading.id); // yesterday's total is not today's
      }
    }
  }

  async failed(err) {
    const reason = err.message;
    if (REFUSED.has(err.kind)) {
      this.refused = true;
      this.logger.warn(`Flo refused the sign-in: ${reason}`);
      await this.setStatus(false, T.refused);
      return;
    }
    let wait;
    if (err.kind === 'rate_limited') {
      wait = Math.max(
        TIMINGS.rateLimitMin,
        Math.min(TIMINGS.rateLimitMax, err.retryAfter ?? TIMINGS.rateLimitDefault),
      );
      this.pausedUntil = this.now() + wait;
      await this.setStatus(this.readAt !== undefined, T.rateLimited(age(wait)));
    } else {
      wait = TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)];
      this.offline = OFFLINE.has(err.kind) || this.offline;
      await this.setStatus(false, T.unreachable(reason, age(wait)));
    }
    this.failures += 1;
    this.nextRefreshAt = this.now() + wait;
    this.logger.warn(`Flo: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  // --- Readings, states, events ----------------------------------------------

  /** A new reading of one device: kept; returns the scene events of its new alerts. */
  update(reading) {
    const previous = this.devices.get(reading.id);
    this.devices.set(reading.id, reading);
    const target = {
      externalId: deviceIds(this.gladys, reading.id).device,
      name: deviceName(reading, this.config.language),
    };
    return alertEvents(target, previous, reading, this.catalog, this.now());
  }

  async publishEvents(events) {
    for (const event of events) {
      this.logger.info(
        `Flo ${event.key} on ${event.data.device_name}: ${event.data.alarm_name ?? 'water'}`,
      );
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
  }

  async publishDevices() {
    if (this.readAt === undefined) {
      return;
    }
    const devices = [...this.devices.values()].map((d) =>
      buildDevice(
        this.gladys,
        d,
        this.config.language,
        this.locations.get(d.locationId ?? this.locationOf.get(d.id))?.name,
      ),
    );
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** The states of the created features (publishChangedStates: changes and a heartbeat). */
  async publishStates(created = this.createdFeatures(), only) {
    const states = [];
    for (const device of this.devices.values()) {
      if (only && !only.has(device.id)) {
        continue;
      }
      const ids = deviceIds(this.gladys, device.id);
      for (const { role, ...value } of statesOf(device, {
        gallonsToday: this.gallons.get(device.id)?.gallons,
        catalog: this.catalog,
      })) {
        const id = ids.feature(role);
        if (created.has(id)) {
          states.push({ device_feature_external_id: id, ...value });
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    // A few devices of eight features at most a minute: far under the 300 states a minute.
    await this.gladys
      .publishChangedStates(states, { heartbeat: TIMINGS.stateHeartbeat })
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  badge(device) {
    if (this.refused || this.offline) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (device.connected === false) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.offline };
    }
    return { transport: DEVICE_TRANSPORTS.CLOUD };
  }

  async publishTransports() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const entries = [];
    for (const device of this.devices.values()) {
      const externalId = deviceIds(this.gladys, device.id).device;
      if (!created.has(externalId)) {
        continue;
      }
      const entry = { external_id: externalId, ...this.badge(device) };
      const json = JSON.stringify(entry);
      if (this.transports.get(externalId) !== json) {
        this.transports.set(externalId, json);
        entries.push(entry);
      }
    }
    if (entries.length > 0) {
      await this.gladys
        .publishTransports(entries)
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.transports.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    await this.publishStates(created);
    await this.publishTransports();
  }

  async deviceDeleted(device) {
    this.transports.delete(device?.external_id);
  }

  /** The Discovery tab asks for a scan: a refresh if the last one is old enough. */
  async scan() {
    if (
      this.client.hasCredentials &&
      !this.refused &&
      this.now() >= this.pausedUntil &&
      (this.readAt === undefined || this.now() - this.readAt >= TIMINGS.testCooldown)
    ) {
      await this.refresh();
      return;
    }
    await this.publishDevices();
  }

  // --- Commands --------------------------------------------------------------

  denied(key) {
    return new Error(word(T.denied[key], this.config.language));
  }

  /** Runs `task` after the previous task of the same key (a promise chain per key). */
  serialized(key, task) {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    this.chains.set(key, tail);
    tail.then(() => {
      if (this.chains.get(key) === tail) {
        this.chains.delete(key);
      }
    });
    return run;
  }

  /** A known device, or a refusal (account refused, not read yet, unknown id). */
  knownDevice(id) {
    if (this.refused) {
      throw this.denied('refused');
    }
    const device = this.devices.get(String(id));
    if (!device) {
      throw this.denied('notReady');
    }
    return device;
  }

  /** The device read again from Flo, now: its states and events published too. */
  async fresh(id) {
    const reading = readingOf(await this.client.device(id));
    reading.id ||= id;
    reading.locationId ??= this.locationOf.get(id);
    const events = this.update(reading);
    await this.publishStates(undefined, new Set([id]));
    await this.publishEvents(events);
    await this.publishTransports();
    return reading;
  }

  /** Reads the devices back after a command, 15 s then 60 s later. */
  readBack(ids) {
    for (const delay of TIMINGS.readBack) {
      const timer = this.timers.setTimeout(async () => {
        this.readBackTimers.delete(timer);
        for (const id of ids) {
          try {
            await this.fresh(id);
          } catch (err) {
            this.logger.warn(`Read back of ${id} failed: ${err.message}`);
          }
        }
      }, delay);
      this.readBackTimers.add(timer);
    }
  }

  /**
   * Opens (`open` true) or closes a shutoff valve, behind the options, one
   * command at a time per device, on a state read just now.
   * Resolves `{ device, valve, changed }`.
   */
  setValve(id, open) {
    if (open && !this.config.allowValveOpen) {
      return Promise.reject(this.denied('valveOpen'));
    }
    if (!open && !this.config.allowValveClose) {
      return Promise.reject(this.denied('valveClose'));
    }
    return this.serialized(`valve:${id}`, async () => {
      const known = this.knownDevice(id);
      if (known.kind !== 'shutoff') {
        throw new Error(`${deviceName(known, 'en')} has no valve`);
      }
      // The options may have changed while the command waited for its turn.
      if ((open && !this.config.allowValveOpen) || (!open && !this.config.allowValveClose)) {
        throw this.denied(open ? 'valveOpen' : 'valveClose');
      }
      let device;
      try {
        device = await this.fresh(id);
      } catch (err) {
        this.logger.warn(`Valve of ${deviceName(known, 'en')}: state not read (${err.message})`);
        throw this.denied('valveUnknown');
      }
      const current = valveAtRest(device);
      if (current === undefined) {
        this.logger.warn(
          `Valve of ${deviceName(device, 'en')}: refused (connected ${device.connected}, valve ${device.valve} -> ${device.valveTarget})`,
        );
        throw this.denied('valveUnknown');
      }
      const target = open ? VALVE.OPEN : VALVE.CLOSED;
      if (current === target) {
        return { device, valve: current, changed: false };
      }
      await this.client.setValve(id, target);
      this.logger.info(`Valve of ${deviceName(device, 'en')}: ${target} requested`);
      this.readBack([id]);
      return { device, valve: target, changed: true };
    });
  }

  /** Home or Away on the location of a device. Resolves `{ device, mode, changed }`. */
  setMode(id, mode) {
    if (mode !== MODES.HOME && mode !== MODES.AWAY) {
      return Promise.reject(this.denied('sleep'));
    }
    let known;
    try {
      known = this.knownDevice(id);
    } catch (err) {
      return Promise.reject(err);
    }
    const locationId = known.locationId ?? this.locationOf.get(known.id);
    return this.serialized(`mode:${locationId}`, async () => {
      const device = await this.fresh(known.id);
      if (device.modeLocked) {
        throw this.denied('modeLocked');
      }
      if (device.mode === mode && (device.modeTarget ?? mode) === mode) {
        return { device, mode, changed: false };
      }
      await this.client.setMode(device.locationId ?? locationId, mode);
      this.logger.info(`Flo location of ${deviceName(device, 'en')}: ${mode} requested`);
      // Every device of the location follows its mode.
      this.readBack(
        [...this.devices.values()]
          .filter((d) => (d.locationId ?? this.locationOf.get(d.id)) === locationId)
          .map((d) => d.id),
      );
      return { device, mode, changed: true };
    });
  }

  /** Gladys command: the valve or the Away switch of a shutoff. */
  async setValueOf(_gladysDevice, feature, value) {
    const target = parseExternalId(feature?.external_id);
    const on = Number(value);
    if (!target || !['valve', 'away'].includes(target.role)) {
      throw new Error(`${feature?.external_id} cannot be set`);
    }
    if (on !== 0 && on !== 1) {
      throw new Error(`Unexpected value "${value}" (0 or 1)`);
    }
    try {
      if (target.role === 'valve') {
        await this.setValve(target.id, on === 1);
      } else {
        await this.setMode(target.id, on === 1 ? MODES.AWAY : MODES.HOME);
      }
    } finally {
      // Gladys shows the value asked for: let the next publication send the real one.
      this.gladys.forgetPublishedStates?.(feature.external_id);
    }
    await this.publishStates(undefined, new Set([target.id]));
  }

  // --- Scene actions ---------------------------------------------------------

  /** `{ device, action: open|close }` -> `{ device_name, valve, changed }`. */
  async sceneSetValve(fields = {}) {
    const target = parseExternalId(fields.device);
    if (!target) {
      throw new Error('Pick a Flo Smart Water Shutoff');
    }
    if (fields.action !== 'open' && fields.action !== 'close') {
      throw new Error('The action is "open" or "close"');
    }
    const result = await this.setValve(target.id, fields.action === 'open');
    return {
      device_name: deviceName(result.device, this.config.language),
      valve: result.valve,
      changed: result.changed,
    };
  }

  /** `{ mode: home|away, device? }` -> `{ mode, locations }`; no device: every home. */
  async sceneSetMode(fields = {}) {
    const mode = String(fields.mode ?? '');
    let ids;
    if (fields.device) {
      const target = parseExternalId(fields.device);
      if (!target) {
        throw new Error('Unknown Flo device');
      }
      ids = [target.id];
    } else {
      if (this.refused) {
        throw this.denied('refused');
      }
      // One device per location, a shutoff when there is one.
      const byLocation = new Map();
      for (const d of this.devices.values()) {
        const location = d.locationId ?? this.locationOf.get(d.id);
        if (!byLocation.has(location) || d.kind === 'shutoff') {
          byLocation.set(location, d.id);
        }
      }
      ids = [...byLocation.values()];
      if (ids.length === 0) {
        throw this.denied('notReady');
      }
    }
    for (const id of ids) {
      await this.setMode(id, mode);
    }
    return { mode, locations: ids.length };
  }

  // --- "Test the connection" button -----------------------------------------

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (this.readAt !== undefined && this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const summary = this.summary();
      return {
        en: `${T.test.cooldown.en} ${summary.en}`,
        fr: `${T.test.cooldown.fr} ${summary.fr}`,
      };
    }
    if (this.now() < this.pausedUntil) {
      return T.rateLimited(age(this.pausedUntil - this.now()));
    }
    this.lastTestAt = this.now();
    // One sign-in per click: the button is how refused credentials are retried.
    this.refused = false;
    this.nextRefreshAt = 0;
    await this.running;
    await this.refresh();
    const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
    if (!connected || this.readAt === undefined) {
      return message ?? T.noCredentials;
    }
    return this.summary();
  }

  summary() {
    const devices = [...this.devices.values()];
    return T.test.summary({
      shutoffs: devices.filter((d) => d.kind === 'shutoff').length,
      sensors: devices.filter((d) => d.kind === 'sensor').length,
      skipped: this.skipped.length,
      locations: this.locations.size,
      method: this.client.method,
    });
  }
}
