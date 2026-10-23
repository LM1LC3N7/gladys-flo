# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
