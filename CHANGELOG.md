# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Flo by Moen account through its e-mail and password: the Flo sign-in, the
  Moen (Smartwater app) sign-in, or both in turn (default); token renewed
  before it expires and once when refused; a refused sign-in is reported and
  never retried by itself.
- Smart Water Shutoff: valve, Away mode switch, mode (home, away, sleep), flow
  rate, water pressure, water temperature, today's consumption and a leak or
  flow alert.
- Water Sensor: water leak, temperature, humidity and battery.
- Opening and closing the valve are off by default, each behind its own
  option; a valve command runs one at a time per device, on the state read
  from Flo just before, and is refused when the valve is offline, moving or
  unknown.
- Home and Away from Gladys (switch and scene action).
- Scene triggers on new leak, abnormal flow and other Flo alerts; scene
  actions to set Home or Away and to open or close the valve.
- Refresh every 2 minutes (1 to 60), pauses after errors and on HTTP 429,
  badges for offline devices.
- "Test the connection" button with a summary of the account.
- Feature names in French or English.

[Unreleased]: https://github.com/LM1LC3N7/gladys-flo/commits/main
