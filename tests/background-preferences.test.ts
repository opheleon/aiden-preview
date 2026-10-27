import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  autostartEntry,
  autostartFile,
  launchedInBackground,
  readBackgroundPreferences,
  saveBackgroundPreferences,
} from '../apps/desktop/src/background-preferences.js';

void test('opening at login is on until the person turns it off, and survives a corrupt file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-background-'));
  assert.deepEqual(await readBackgroundPreferences(root), {
    schemaVersion: 1,
    openAtLogin: true,
    noticeShown: false,
  });
  await saveBackgroundPreferences(root, { openAtLogin: false });
  await saveBackgroundPreferences(root, { noticeShown: true });
  assert.deepEqual(await readBackgroundPreferences(root), {
    schemaVersion: 1,
    openAtLogin: false,
    noticeShown: true,
  });
  await mkdir(path.join(root, 'preferences'), { recursive: true });
  await writeFile(path.join(root, 'preferences', 'background.json'), '{broken');
  assert.equal((await readBackgroundPreferences(root)).openAtLogin, true);
});

void test('the login item launch is recognized only by its flag', () => {
  assert.equal(launchedInBackground(['/opt/Aiden/aiden', '--background']), true);
  assert.equal(launchedInBackground(['/opt/Aiden/aiden']), false);
  assert.equal(launchedInBackground(['/opt/Aiden/aiden', '--background=no']), false);
});

void test('the Linux autostart entry quotes the executable and lives in the XDG config folder', () => {
  const entry = autostartEntry('/home/dana/Apps/My "Aiden" $HOME.AppImage');
  assert.match(entry, /^\[Desktop Entry\]\n/);
  assert.ok(
    entry.includes('Exec="/home/dana/Apps/My \\"Aiden\\" \\$HOME.AppImage" --background\n'),
  );
  assert.equal(
    autostartFile({ XDG_CONFIG_HOME: '/home/dana/.config-custom' }),
    path.join('/home/dana/.config-custom', 'autostart', 'ai.opheleon.aiden.desktop'),
  );
});
