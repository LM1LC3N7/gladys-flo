# TODO — Flo by Moen v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test` (Node
  22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session.

## Status

- [x] **Milestone 1 — core** (2026-10-16): Flo and Moen sign-ins ("auto"
      tries Flo then Moen), token renewal, account and devices every 2 min,
      consumption every 15 min, alarm catalog daily; Smart Water Shutoff
      (valve, away, mode, flow, pressure, water temperature, today's use,
      alert) and Water Sensor (leak, temperature, humidity, battery); valve
      safety (options off, serialized, fresh read, refused when unknown);
      Home/Away; scene triggers (leak, abnormal flow, any alert) and actions
      (mode, valve); badges; test button; en/fr; docs; cover. Tested against
      simulated answers only.
- [ ] **Milestone 2 — real account**: run against a real Flo account and
      compare with the Moen app (see "To check"); turn the answers
      (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: health test (run, result), sleep mode with a
      duration (scene action), a dashboard widget (valve, flow, today's use),
      daily/monthly consumption history (publishEnergyConsumption-like
      backfill), Wi-Fi signal, firmware.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real account

- Which sign-in a 2026 account accepts: the legacy `users/auth` (aioflo says
  it still works) or only the Moen SSO; the exact error status of a wrong
  password on each.
- The Water Sensor (`puck_oem`) answer: `fwProperties.telemetry_water`,
  `battery.level`, `telemetry.current.{tempF,humidity}` are the fields Home
  Assistant reads; no real answer seen here.
- The alarm ids and names of the catalog (`GET /alarms`): the leak / flow
  families are guessed from the names (`water_detected`, `small_drip`,
  `fast_water_flow`, `high_water_usage`…); the made-up catalog of the tests
  is not Flo's.
- `water/consumption` with naive local dates of the location's day: does Flo
  read them in the location's time zone (the answer's `params.tz` suggests
  so)?
- Whether `notifications.pending.alarmCount` counts go up on a new
  occurrence, or stay at 1 (then a repeat of the same alarm while pending
  fires nothing).
- `valve.lastKnown` values in transit (`opening`? `closing`?) and how fast
  the device reports the new position (read back at 15 s and 60 s).
- A 403 of the Flo API that is not CloudFront: a refused token (renewed once)
  or something else.
- HTTP rate limits: none documented; watch for 429.

## Decisions

- **Reference reused: aioflo** (MIT, https://github.com/bachya/aioflo — the
  brief named home-assistant-libs/aioflo, which `git clone` did not find on
  2026-10-16; bachya/aioflo is the repository of its author, with commits in
  2026 and the Moen SSO flow). It cannot
  run in a Node container: its logic (endpoints, both sign-ins, headers,
  commands, consumption, alarm catalog, the 212 °F placeholder rule) is
  ported to JavaScript, with the MIT notice in `THIRD_PARTY_NOTICES.md`
  (copied into the image, like `LICENSE`). No JavaScript Flo client exists on
  npm. Single runtime dependency: the Gladys SDK.
- **Sign-in "auto" by default**: Flo first (what Home Assistant uses), then
  Moen when Flo refuses (400/401/403) or answers 404/410 (endpoint retired);
  a passing failure (network, 5xx, 429, CloudFront) never switches. Both
  refused -> "refused", never retried by itself (test button or a change of
  configuration). The flow that worked is tried first next time.
- **Valve as a switch**: once an option is on, the valve is reachable by voice
  assistants and "turn everything off"; written in the docs (review).
- **Token**: memory only; renewed 5 min before expiry (aioflo: 60 s); a token
  refused by the API is renewed once and the call retried once — refused
  again, the refresh fails with a backoff (1, 2, 5, 10, 15 min), no loop. A
  Moen refresh token refused -> one full sign-in.
- **Errors**: 401/403 on a sign-in endpoint = refused; 401/403 on the API =
  token refused (renewed once); a 403 from CloudFront (`x-cache`, `server`
  or body) = passing; 429 = pause for Retry-After (1 min–1 h, 5 min without);
  5xx/network/timeout = backoff. Never an integration left without a retry
  timer, except refused credentials (by design, the test button retries).
- **User-Agent**: aioflo's browser User-Agent, Origin and Referer, kept as is
  (the only ones known to work with the Flo API).
- **Valve safety (Louis's rule)**: `allow_valve_open` and `allow_valve_close`
  both off by default, checked before anything and again when the command
  gets its turn; commands serialized per device (promise chain covering the
  read and the command); the device read again (`GET devices/{id}`) just
  before acting; refused when that read fails, the device is offline
  (`isConnected` not true), the valve is not `open`/`closed`, or its target
  differs from its last known position (moving); nothing sent when already
  in place; read back at 15 s and 60 s. The state in memory never decides.
- **Mode**: Home/Away behind `allow_mode_change` (below), serialized per location, on a fresh
  read; sleep refused (needs a duration, set in the Moen app); a locked mode
  (`systemMode.isLocked`) refused. Exposed as an "away" switch (1 away, 0
  home or sleep) plus a read-only text feature (home/away/sleep): the
  text/select type is too new to rely on in the dashboard.
- **Units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`, fixed at creation):
  flow `water-valve/flow` in m³/h (the only unit the core allows; gpm ×
  0.2271), pressure `pressure-sensor/decimal` in psi, water temperature
  `temperature-sensor/probe` in °C (kept out of the room average), today's
  use `volume-sensor/decimal` in litres, sensor temperature °C, humidity %,
  battery %. Valve and away are `switch/binary` (1 open / 1 away; the
  water-valve category has no binary type).
- **Alert features of the shutoff (review, fixed now: types are frozen at
  creation)**: `leak_alert` (`leak-sensor/binary`, "Leak alert") is 1 while
  an alert of the leak family is pending — flow alerts no longer turn it on;
  when the catalog does not know an alert (catalog unavailable or a new id), a
  critical one turns it on, by caution. `alerts` (`text/text`, "Pending
  alerts") lists every pending alert ("Title (severity)", or "none").
- **Alert families**: an explicit list of known names (`KNOWN_ALARMS` in
  src/flo/model.js: water_detected, small_drip[_category_1–4],
  health_test_failed; fast_water_flow, high_flow_rate, high_water_usage,
  high_water_use, extended_water_use, long_flow_event), exact match, no
  pattern; any other name is "other". Severity: the alert's (case
  normalized), else the catalog's, else none (unknown values dropped).
- **Scene triggers**: computed by the refresh only (never in a command chain:
  a command's read does not mark an alert seen), one event per alert whose
  pending count goes up; `leak_detected` and `abnormal_flow` for critical or
  warning alerts only (a `severity` filter field), `alert_raised` for all; at
  most one `leak_detected` per device and refresh. The 9 keys of the event
  data are the same for the three triggers.
- **Seen state in /data** (`flo-seen.json`: alert counts and water flag per
  device, no secret; temporary file then rename): an alert raised while the
  integration restarts fires at the next start; a device absent from the file
  is a baseline (fires nothing). Write failures are logged, not fatal. The
  docs recommend a "device state" trigger on `leak` / `leak_alert` to shut
  the water off, which does not depend on events.
- **Readings numbered** at the start of their request: an older answer
  (a refresh's read overtaken by a command's read) never overwrites a newer
  one; the triggers use the newest reading.
- **Command deadline**: set_value is acked within 5 s, so a valve or mode
  command not sent within 3.5 s of its arrival is refused ("waited too
  long"), never sent late; 25 s for the scene actions (timeout 30 s). The
  command's requests get short timeouts (what is left of the deadline,
  0.5–10 s; +1 s for the POST). States and badges are published after the
  POST (or the refusal); a failed POST is read back too (it may have reached
  the valve); a valve already moving to the target is `changed: false`.
- **`allow_mode_change`, off by default — PROVISIONAL, pending Louis's
  decision** (review 2026-10-16): the brief allowed Home/Away, but Home
  disarms the automatic shutoff Flo applies in Away; the switch and the
  `set_mode` scene action are refused until the user turns it on (warning in
  the docs).
- **Auto sign-in**: once Flo refused the credentials, only Moen is tried until
  the configuration changes. A 403 with `x-amzn-errortype` (AWS API Gateway)
  is `not_found` (MissingAuthenticationToken) or passing, never "refused".
  Token renewed min(5 min, half its lifetime) before expiry.
- **Token renewal on a refusal** (approval): only on a 401 (a 403 refuses the
  resource, not the token), and never for a token issued less than 60 s ago.
  A device Flo refuses (401/403, after that renewal) is skipped and not read
  again for 1 h (the test button asks again at once): one forbidden device no
  longer costs a password sign-in per refresh.
- **Test button and "auto"** (approval): the button forgets a Flo refusal
  (`client.retryAll()`) and tries Flo first, then Moen: a passing Flo refusal
  does not lock the account on Moen.
- **Commands** (approval): the ack does not wait for the publications to
  Gladys after the POST (started in the background, errors logged); a valve
  already moving to the target returns its real position and is read back.
- **Password**: kept by Gladys in its database in clear (a `secret` field is
  only hidden in the interface, and is in the backups); the docs and the
  manifest say so, no "encrypted" claim.
- **Pace**: account + every device every 2 min by default (1–60; Home
  Assistant: 1 min), consumption every 15 min per shutoff, alarm catalog once
  a day (an hour later after a failure). States through
  `publishChangedStates` with a 30-min heartbeat: a few devices stay far under
  300 states a minute.
- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json` and the
  manifest (with the `docker_image` tag `ghcr.io/lm1lc3n7/gladys-flo:0.1.0`):
  the one-time exception to "versions belong to the Release workflow"; the
  first patch release gives 0.1.1.
- **Not checked by this session**: duplicates in the store / the core / the
  forum thread (done by the pipeline before the wave).
