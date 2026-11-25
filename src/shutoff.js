// -----------------------------------------------------------------------------
// The shutoffs kept: closing a valve shuts the water off, it protects, so it
// is never refused (Louis's decision, 2026-11-25, model: gladys-drop).
//
// A shutoff clicked is kept, in memory and in /data, until a reading of Flo
// started after it was sent shows the valve closed (device online). Until
// then it is sent again:
//   - after each send, checked `check` later (the device is read again):
//     sent again `resends` times, then every `heldEvery` (held);
//   - at each restart (from /data) and when Flo answers again after a
//     failure (fireAll), with a new budget, unless sent less than `minGap`
//     ago;
//   - never while Flo asks to slow down (its pause is waited for), never
//     while the account is refused (it leaves with new credentials).
// It is given up `expiry` after it first left in this process (monotonic
// clock, said in the status), when Flo does not know the device (404), when
// the device is deleted in Gladys, or let go by an opening sent after it.
// Once seen closed it is done: an opening made later elsewhere (the Moen
// app) is never fought.
//
// The decisions use the monotonic clock only; `at` (wall clock) is the
// moment of the click, kept in /data for the logs.
// -----------------------------------------------------------------------------

const noop = () => {};

export class ShutoffKeeper {
  /**
   * @param {object} o
   * @param {(entry: object) => Promise<unknown>} o.send   sends one shutoff (rejects with `kind`)
   * @param {(entry: object) => Promise<unknown>} o.read   reads the device (the app calls observe())
   * @param {() => ({ blocked?: true, wait?: number })} o.ready  can a request leave now
   * @param {(entries: object[]) => Promise<void>} o.save  writes /data
   * @param {object} o.timings  { check, resends, heldEvery, expiry, minGap, openBlock }
   */
  constructor({
    send,
    read,
    ready,
    save,
    onChange = noop,
    onRateLimited = noop,
    logger,
    timers,
    monotonic,
    wallNow,
    timings,
  }) {
    Object.assign(this, { send, read, ready, save, onChange, onRateLimited, logger, timers });
    this.monotonic = monotonic;
    this.wallNow = wallNow;
    this.timings = timings;
    /** device id -> entry */
    this.entries = new Map();
    /** device id -> number of shutoffs clicked (an opening waiting its turn compares it). */
    this.clicks = new Map();
    /** Names of the shutoffs given up after `expiry`, newest first (status). */
    this.givenUp = [];
    this.seq = 0;
    this.stopped = false;
    /** A shutoff could not leave (account refused): fireAll() once the account works again. */
    this.blocked = false;
    this.saving = Promise.resolve();
  }

  /** A number growing at each call: a reading takes one when it starts. */
  ticket() {
    this.seq += 1;
    return this.seq;
  }

  clickCount(id) {
    return this.clicks.get(String(id)) ?? 0;
  }

  /** A shutoff clicked less than `openBlock` ago: an opening now is refused. */
  justClicked(id) {
    const entry = this.entries.get(String(id));
    return entry !== undefined && this.monotonic() - entry.clickedAt < this.timings.openBlock;
  }

  /** The shutoffs read from /data, added to those clicked since. Not sent here (fireAll). */
  restore(list) {
    for (const s of list) {
      const id = String(s.id);
      if (this.entries.has(id)) {
        continue;
      }
      this.entries.set(id, this.newEntry(id, s.name || id, s.at, -Infinity));
      this.logger.info(`Shutoff of ${s.name || id} kept from before the restart: sent again`);
    }
  }

  newEntry(id, name, at, clickedAt) {
    return {
      id,
      name,
      at,
      clickedAt,
      budget: this.timings.resends,
      held: false,
      sends: 0,
      lastSent: -Infinity,
      firstSent: undefined,
      startTicket: Infinity,
      doneTicket: Infinity,
      inFlight: undefined,
      timer: undefined,
      /** The error of the last send, if it failed. */
      lastError: undefined,
    };
  }

  /**
   * A shutoff clicked: kept (memory, /data without waiting), every opening of
   * the device still waiting its turn cancelled, sent now. Resolves the
   * promise of its send: 'sent' | 'failed' | 'paused' | 'blocked'.
   */
  click(id, name) {
    id = String(id);
    this.stopped = false;
    this.clicks.set(id, this.clickCount(id) + 1);
    this.givenUp = this.givenUp.filter((n) => n !== name);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = this.newEntry(id, name, this.wallNow(), this.monotonic());
      this.entries.set(id, entry);
    }
    Object.assign(entry, {
      name,
      at: this.wallNow(),
      clickedAt: this.monotonic(),
      budget: this.timings.resends,
      held: false,
      // A new click: its 24 h count from its own first send.
      firstSent: undefined,
    });
    this.persist();
    this.onChange();
    return this.fire(entry);
  }

  /** At a restart or when Flo answers again: every shutoff kept leaves again, with a new budget. */
  fireAll() {
    this.stopped = false;
    this.blocked = false;
    for (const entry of this.entries.values()) {
      if (entry.inFlight || this.monotonic() - entry.lastSent < this.timings.minGap) {
        continue;
      }
      entry.budget = this.timings.resends;
      entry.held = false;
      this.fire(entry).catch(noop);
    }
  }

  /** Sends one shutoff now, unless one is in flight (that one is returned). */
  fire(entry) {
    if (entry.inFlight) {
      return entry.inFlight;
    }
    if (this.stopped || this.entries.get(entry.id) !== entry) {
      return Promise.resolve('blocked');
    }
    const ready = this.ready();
    if (ready.blocked) {
      // Account refused or no credentials: sent by fireAll() once it works again.
      this.blocked = true;
      this.clear(entry);
      return Promise.resolve('blocked');
    }
    if (ready.wait > 0) {
      this.arm(entry, ready.wait);
      return Promise.resolve('paused');
    }
    this.clear(entry);
    entry.sends += 1;
    entry.lastSent = this.monotonic();
    // The 24 h count from the first send in this process.
    entry.firstSent ??= entry.lastSent;
    entry.startTicket = this.ticket();
    const run = (async () => {
      try {
        await this.send(entry);
        entry.lastError = undefined;
        this.logger.info(`${entry.name}: shutoff sent (${entry.sends})`);
        return 'sent';
      } catch (err) {
        entry.lastError = err;
        this.logger.warn(`${entry.name}: shutoff not sent (${err.message})`);
        if (err.kind === 'not_found') {
          this.letGo(entry.id, 'given up: the cloud does not know this device');
        } else if (err.kind === 'rate_limited') {
          this.onRateLimited(err);
        }
        return 'failed';
      } finally {
        // A reading that starts from now on is one made after the send.
        entry.doneTicket = this.ticket();
        entry.inFlight = undefined;
        if (!this.stopped && this.entries.get(entry.id) === entry) {
          this.arm(entry, entry.held ? this.timings.heldEvery : this.timings.check);
        }
      }
    })();
    entry.inFlight = run;
    return run;
  }

  arm(entry, delay) {
    this.clear(entry);
    if (this.stopped) {
      return;
    }
    entry.timer = this.timers.setTimeout(() => {
      entry.timer = undefined;
      this.check(entry).catch((err) => this.logger.warn(`Shutoff check failed: ${err.message}`));
    }, delay);
  }

  clear(entry) {
    if (entry.timer !== undefined) {
      this.timers.clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  /** Not seen closed yet: read again, then sent again within its budget, then held. */
  async check(entry) {
    if (this.stopped || this.entries.get(entry.id) !== entry || entry.inFlight) {
      return;
    }
    if (
      entry.firstSent !== undefined &&
      this.monotonic() - entry.firstSent >= this.timings.expiry
    ) {
      this.givenUp = [entry.name, ...this.givenUp.filter((n) => n !== entry.name)].slice(0, 3);
      this.letGo(entry.id, 'given up: not seen closed in 24 h');
      return;
    }
    const ready = this.ready();
    if (ready.blocked) {
      this.blocked = true;
      return;
    }
    if (ready.wait > 0) {
      this.arm(entry, ready.wait);
      return;
    }
    try {
      await this.read(entry);
    } catch (err) {
      this.logger.info(`${entry.name}: shutoff check, device not read (${err.message})`);
    }
    if (this.stopped || this.entries.get(entry.id) !== entry || entry.inFlight) {
      return;
    }
    if (entry.held) {
      this.fire(entry).catch(noop);
    } else if (entry.budget > 0) {
      entry.budget -= 1;
      this.fire(entry).catch(noop);
    } else {
      entry.held = true;
      this.logger.warn(`${entry.name}: shutoff not seen closed, held (sent again every 15 min)`);
      this.arm(entry, this.timings.heldEvery);
      this.onChange();
    }
  }

  /**
   * A reading of the device: `closed` true when it shows the valve closed,
   * `ticket` taken when the reading started. Seen closed by a reading
   * started after a send ended: done.
   */
  observe(id, closed, ticket) {
    const entry = this.entries.get(String(id));
    if (entry && closed === true && ticket > entry.doneTicket) {
      this.letGo(entry.id, 'confirmed: the valve is closed');
    }
  }

  /** Done, let go or given up: forgotten (memory and /data). */
  letGo(id, why) {
    const entry = this.entries.get(String(id));
    if (!entry) {
      return false;
    }
    this.clear(entry);
    this.entries.delete(entry.id);
    this.logger.info(`${entry.name}: shutoff ${why}`);
    this.persist();
    this.onChange();
    return true;
  }

  /** Writes /data, one write at a time, never awaited by a shutoff. */
  persist() {
    const list = [...this.entries.values()].map(({ id, name, at }) => ({ id, name, at }));
    this.saving = this.saving
      .then(() => this.save(list))
      .catch((err) => this.logger.warn(`Saving the shutoffs failed: ${err.message}`));
    return this.saving;
  }

  /** No timer and no send after this (shutdown, or a restart about to come). */
  stop() {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      this.clear(entry);
    }
  }

  summary() {
    const entries = [...this.entries.values()];
    return {
      kept: entries.length,
      held: entries.filter((e) => e.held).length,
      givenUp: [...this.givenUp],
    };
  }
}
