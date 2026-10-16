# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

This repository: **Flo by Moen** (Smart Water Shutoff and Water Sensors)
through the Flo cloud, the logic of aioflo (MIT, see THIRD_PARTY_NOTICES.md)
ported to JavaScript. Decisions and open questions live in `TODO.md`.

**Valve safety is not negotiable**: `allow_valve_open` and `allow_valve_close`
stay off by default; a valve command is serialized per device, decided on the
state read from Flo just before (never on the state in memory), and refused
when that state is unknown, moving or offline. Keep the tests that prove it.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers before connect())
src/handlers.js                   the SDK handlers -> FloApp (shared with the tests)
src/app.js                        FloApp: refresh loop, states, badges, commands, scene actions
src/flo/client.js                 Flo cloud client: sign-ins, token, calls, error kinds
src/flo/model.js                  Flo answers -> readings (pure)
src/devices.js                    readings -> Gladys devices and states (pure)
src/triggers.js                   new alerts -> scene events (pure)
src/http.js                       the only network access (fetch, timeout); setFetch() in tests
src/config.js                     DEFAULTS (mirror the manifest) + normalization
src/constants.js, src/i18n.js     endpoints, keys, timings; en/fr texts
gladys-assistant-integration.json manifest: name, config_schema, actions, scene triggers/actions
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, SDK fake Gladys + test/helpers/fakeFlo.js
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network, and pass on Node 22 and 24.
- **Encoding.** Text files are UTF-8 without BOM; `test/manifest.test.js`
  refuses mojibake and a BOM. Write files with an editor, never with
  PowerShell's `Set-Content`/`Out-File` defaults.
