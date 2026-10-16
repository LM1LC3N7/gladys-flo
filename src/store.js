// -----------------------------------------------------------------------------
// What the scene triggers last saw of each device (alert counts, water flag),
// kept in /data, the one writable volume, so that a leak raised while the
// integration restarts still fires its trigger. No secret is written here.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'flo-seen.json';

/** deviceId -> seen (src/triggers.js seenOf); empty when absent or unreadable. */
export async function loadSeen(dir) {
  if (!dir) {
    return new Map();
  }
  try {
    const json = JSON.parse(await readFile(join(dir, FILE), 'utf8'));
    const devices = json?.version === 1 && json.devices && typeof json.devices === 'object';
    return new Map(devices ? Object.entries(json.devices) : []);
  } catch {
    return new Map();
  }
}

/** Writes the map (temporary file then rename: never a half-written file). */
export async function saveSeen(dir, seen) {
  if (!dir) {
    return;
  }
  await mkdir(dir, { recursive: true });
  const target = join(dir, FILE);
  const body = JSON.stringify({ version: 1, devices: Object.fromEntries(seen) });
  await writeFile(`${target}.tmp`, body, 'utf8');
  await rename(`${target}.tmp`, target);
}
