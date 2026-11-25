# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- **Closing the valve (shutting the water off) is never refused any more and
  needs no option**: it protects (Louis's rule of 2026-11-25). The shutoff
  leaves at once, without reading the valve first, and is kept, also across a
  restart, until Flo shows the valve closed by a reading made after it was
  sent: read again 90 s after each send and sent again if needed (3 times,
  then every 15 minutes), sent again when Flo answers after an outage,
  waiting for the pause Flo asks for. It is given up 24 hours after it first
  left without Flo showing the valve closed, as the integration status says.
  Once seen closed, reopening the water in the Moen app is never fought.
- A click sends the shutoff at once even during a pause Flo asked for (one
  request); a failed send is tried again after 15 seconds; a shutoff is let
  go when Flo shows an opening asked after it (Moen app), never fought.
- Opening the valve stays off by default; when allowed, it is refused within
  20 seconds of a shutoff of the same valve not yet seen closed, cancelled by
  a shutoff asked while it waits its turn, and an opening sent lets an older
  shutoff go.
- The integration starts from the configuration Gladys gave at the
  connection; if it is missing, it is asked again, spaced, with an exact
  status (never taken for refused credentials).
- Integration SDK 0.16.1 (no change for the devices).

### Added

- **Buttons "Shut the water off" and "Turn the water on"** on the Smart
  Water Shutoff (opening behind its option), and "Valve open" (read only).
  A button is never reached by a "turn everything off" command or a scene
  acting on every switch.

### Removed

- The valve switch is no longer offered in Discovery. On a device added
  before, it keeps working (your scenes still close the valve) but a "turn
  everything off" could now shut the water off. **What to do**: in your
  scenes, replace the valve switch with the "Shut the water off" button (or
  the scene action "Flo: open or close the valve"), then run Discovery again
  and save the device.
- The option "Allow closing the valve" (`allow_valve_close`): closing is
  always allowed. A configuration that still holds it keeps working, the
  value is ignored.

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-17

### Added

- Flo by Moen account through its e-mail and password: the Flo sign-in, the
  Moen (Smartwater app) sign-in, or both in turn (default); token renewed
  before it expires and once when refused; a refused sign-in is reported and
  never retried by itself.
- Smart Water Shutoff: valve, Away mode switch, mode (home, away, sleep), flow
  rate, water pressure, water temperature, today's consumption, a leak alert
  and the list of pending alerts.
- Water Sensor: water leak, temperature, humidity and battery.
- Opening and closing the valve are off by default, each behind its own
  option; a valve command runs one at a time per device, on the state read
  from Flo just before, is refused when the valve is offline, moving the
  other way or unknown, and is refused rather than sent late.
- Home and Away from Gladys (switch and scene action), off by default behind
  its own option (Home disarms Flo's automatic shutoff).
- Scene triggers on new leak and abnormal flow alerts (critical or warning)
  and on any new Flo alert, including the ones raised while the integration
  restarted; scene actions to set Home or Away and to open or close the
  valve.
- Refresh every 2 minutes (1 to 60), pauses after errors and on HTTP 429,
  badges for offline devices.
- "Test the connection" button with a summary of the account.
- Feature names in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-flo/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-flo/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-flo/releases/tag/v0.1.1
