# gladys-flo

[Gladys Assistant](https://gladysassistant.com) external integration for
**Flo by Moen**: the Smart Water Shutoff (flow, pressure, water temperature,
today's use, valve, Home/Away/Sleep mode, alerts) and the Flo Water Sensors
(leak, temperature, humidity, battery), through the Flo cloud the Moen
Smartwater app uses, with the account's e-mail and password. Opening and
closing the valve are off until the user allows each of them. Unofficial, not
affiliated with Moen.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Tested with simulated answers only,
> never with a real Flo device or account.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (FloApp) ⇄ src/flo/client.js ⇄ src/http.js ⇄ api.meetflo.com / api-gw.meetflo.com / Moen SSO
                                   ├─ src/flo/model.js  Flo answers -> readings (pure)
                                   ├─ src/devices.js    -> Gladys devices and states (pure)
                                   └─ src/triggers.js   new alerts -> scene events (pure)
```

- **Sign-in** (`login_method`): `flo` posts the e-mail and password to
  `api.meetflo.com/api/v1/users/auth` (token as is in `Authorization`, user id
  and lifetime in the answer); `moen` uses the Moen SSO (Cognito) of the
  current app (bearer token, refresh token, `users/me`); `auto` (default)
  tries Flo, then Moen when Flo refuses or answers 404. Renewed 5 minutes
  before expiry, and once when the API refuses the token. A refused sign-in is
  never retried by itself. Nothing is written to `/data`.
- **Reading**: `users/{id}?expand=locations`, then `devices/{id}` for each
  device every `refresh_interval` minutes (2 by default, 1 to 60);
  `water/consumption` (today, local time of the location) every 15 minutes per
  shutoff; the alarm catalog (`alarms`) once a day. Errors back off 1, 2, 5,
  10 then 15 minutes; a 429 pauses for its Retry-After (1 min to 1 h); a
  CloudFront 403 is a passing error, not a refusal.
- **Devices**: `ext:<selector>:flo:<deviceId>`, the Flo device id. Shutoff
  (`flo_device_v2`): valve and away switches, mode text, flow (m³/h), pressure
  (psi), water temperature (°C, probe), today's use (L), leak alert (leak
  family only), pending alerts (text). Water Sensor (`puck_oem`): leak,
  temperature, humidity, battery. Others are skipped. Readings are numbered:
  an older answer never overwrites a newer one.
- **Valve**: `POST devices/{id}` `{ valve: { target } }` behind
  `allow_valve_open` / `allow_valve_close` (both off), one command at a time
  per device, the device read again just before (refused when offline,
  moving the other way, unknown or unreadable), refused if not sent within
  3.5 s of a set_value (25 s for a scene action), read back 15 s and 60 s
  later (after a failure too).
- **Mode**: `POST locations/{id}/systemMode` `{ target: home|away }` behind
  `allow_mode_change` (off: Home disarms Flo's automatic shutoff); sleep
  needs a duration and is refused; a locked mode is refused.
- **Scene triggers**: `leak_detected`, `abnormal_flow` (critical or warning,
  known alarm names) and `alert_raised`, at the refresh that sees an alert's
  pending count go up (or a Water Sensor start reporting water). What was
  seen is kept in `/data/flo-seen.json`, so alerts raised during a restart
  fire at the next start.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/helpers/fakeFlo.js` serves the fixtures of `test/fixtures/` behind
`fetch` (both sign-ins, account, devices, commands, consumption, alarm
catalog). The shutoff and consumption fixtures come from aioflo's tests; the
Water Sensor, account and alarm catalog fixtures are made up from the field
names aioflo and Home Assistant read.

## Credits

- [aioflo](https://github.com/bachya/aioflo) (MIT, Aaron Bach), the Python
  client of the Home Assistant Flo integration: endpoints, both sign-in flows,
  headers, commands, consumption, alarm catalog, the water temperature
  placeholder. Read as the reference and ported to JavaScript (no Python runs
  here); its notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
  shipped in the image.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0 ([LICENSE](LICENSE)); the ported aioflo logic is MIT
([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Flo by Moen and Moen are
trademarks of Moen Incorporated; this project is not affiliated with Moen.
