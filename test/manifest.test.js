// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. They also guard
// the text files against mojibake and a BOM (lesson of the first wave).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import {
  ACTIONS,
  ALERT_CATEGORIES,
  LOGIN_METHODS,
  REFRESH_INTERVAL,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  SEVERITIES,
} from '../src/constants.js';
import { catalogOf, readingOf } from '../src/flo/model.js';
import { alertEvents } from '../src/triggers.js';
import { NOW, fixture } from './helpers/fakeFlo.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, />=5\.1\.0/, 'scene triggers and actions need 5.1.0');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-flo:${manifest.version}`);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(JSON.parse(read('package-lock.json')).version, pkg.version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-flo/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    // One line: the sentences may wrap, inside a quote block too.
    const docs = read(`docs/${lang}.md`).replace(/\s*\n>?\s*/g, ' ');
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Moen|sans\s+lien\s+avec\s+Moen/);
    assert.match(docs, /never\s+been\s+tested|jamais\s+été\s+testée/);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('no mojibake (UTF-8 read as Latin-1) nor BOM in the text files', () => {
  // "Ã©" for "é", "Â " for a no-break space, "â€" for a dash or a quote…
  const mojibake = /[ÂÃ][\u0080-¿€]|â€/;
  for (const path of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'THIRD_PARTY_NOTICES.md',
    'src/i18n.js',
  ]) {
    const text = read(path);
    assert.ok(!text.startsWith('﻿'), `${path} starts with a BOM`);
    const match = mojibake.exec(text);
    assert.equal(match, null, `${path}: mojibake "${match?.[0]}" at ${match?.index}`);
  }
});

test('the MIT notice of aioflo ships with the code', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /aioflo/);
  assert.match(notices, /Copyright \(c\) 2020-2026 Aaron Bach/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY .*LICENSE/);
  assert.match(dockerfile, /COPY .*THIRD_PARTY_NOTICES\.md/);
  assert.match(read('LICENSE'), /Apache License/);
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.login_method.options.map((o) => o.value),
    Object.values(LOGIN_METHODS),
  );
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret', 'the password is never sent back to the browser');
  assert.equal(fields.email.required && fields.password.required, true);
  assert.deepEqual(
    [fields.refresh_interval.min, fields.refresh_interval.max],
    [REFRESH_INTERVAL.min, REFRESH_INTERVAL.max],
  );
  for (const key of ['allow_valve_open', 'allow_valve_close']) {
    assert.equal(fields[key].type, 'boolean');
    assert.equal(fields[key].default, false, `${key} is off by default (Louis's rule)`);
  }
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
  }
  assert.ok(intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  assert.ok(handlers.includes('onSetValue'), 'the commands go through onSetValue');
  for (const item of [...manifest.actions, ...manifest.scene_actions]) {
    assert.ok(item.timeout_seconds >= 5 && item.timeout_seconds <= 120, item.key);
  }
  const alert = manifest.scene_triggers.find((t) => t.key === SCENE_TRIGGERS.ALERT);
  const options = (key) => alert.fields.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('severity'), SEVERITIES);
  assert.deepEqual(options('category'), Object.values(ALERT_CATEGORIES));
});

test('every trigger field and variable is a key of the events the code fires', () => {
  const catalog = catalogOf(fixture('alarms.json'));
  const before = readingOf(fixture('device-shutoff.json'));
  const after = {
    ...before,
    alarms: [
      { id: 10, severity: 'critical', count: 1 },
      { id: 28, severity: 'warning', count: 1 },
    ],
  };
  const events = alertEvents(
    { externalId: 'ext:flo:flo:x', name: 'X' },
    before,
    after,
    catalog,
    NOW,
  );
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} is fired by the code`);
    for (const { key } of [...trigger.fields, ...trigger.variables]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    assert.ok(Object.keys(event.data).length <= 30);
  }
});
