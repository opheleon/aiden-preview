import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setImmediate as nextTick } from 'node:timers/promises';

import { UpdateService } from '../apps/desktop/src/update-service.js';
import type { UpdateStatus } from '../apps/desktop/src/update-types.js';

class Backend extends EventEmitter {
  autoDownload = true;
  allowPrerelease = false;
  autoInstallOnAppQuit = true;
  checks = 0;
  downloads = 0;
  installs = 0;
  failure = false;
  backgroundDownload: Promise<unknown> | undefined;
  checkForUpdates() {
    this.checks++;
    if (this.failure) return Promise.reject(new Error('/private/path?token=secret'));
    return Promise.resolve({ downloadPromise: this.backgroundDownload });
  }
  downloadUpdate() {
    this.downloads++;
    if (this.failure) return Promise.reject(new Error('/private/path?token=secret'));
    return Promise.resolve();
  }
  quitAndInstall() {
    this.installs++;
  }
}
async function fixture(version = '1.1.0', enabled = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-updates-'));
  const backend = new Backend();
  const publications: UpdateStatus[] = [];
  let busy = false;
  const service = new UpdateService({
    dataRoot: root,
    version,
    enabled,
    backend,
    isRunActive: () => busy,
    publish: (status) => publications.push(status),
  });
  return {
    root,
    backend,
    service,
    publications,
    setBusy(value: boolean) {
      busy = value;
    },
  };
}

void test('development updates are disabled and closed services do not restart', async () => {
  const f = await fixture('1.1.0', false);
  await f.service.start();
  await f.service.start();
  assert.equal(f.service.snapshot().state, 'disabled');
  await f.service.check();
  await f.service.download();
  f.service.install();
  assert.equal(f.backend.checks + f.backend.downloads + f.backend.installs, 0);
  f.service.dispose();
  await f.service.start();
  await assert.rejects(
    f.service.setPreferences({ autoDownload: false, channel: 'beta' }),
    /closed/,
  );
});

void test('automatic download rejection is handled after the check returns without blocking the renderer', async () => {
  const f = await fixture();
  let rejectDownload!: (error: Error) => void;
  f.backend.backgroundDownload = new Promise((_, reject) => {
    rejectDownload = reject;
  });
  try {
    await f.service.start();
    await f.service.check();
    rejectDownload(new Error('/private/path?token=secret'));
    await nextTick();
    assert.equal(f.service.snapshot().state, 'error');
    assert.doesNotMatch(JSON.stringify(f.publications), /private|secret/);
  } finally {
    f.service.dispose();
  }
});

void test('corrupt preferences recover offline and beta builds persist their update route', async () => {
  const f = await fixture('1.2.0-beta.1');
  await mkdir(path.join(f.root, 'preferences'));
  await writeFile(path.join(f.root, 'preferences', 'updates.json'), 'corrupt');
  try {
    await f.service.start();
    assert.deepEqual(f.service.getPreferences(), { autoDownload: true, channel: 'beta' });
    assert.equal(f.backend.allowPrerelease, true);
    assert.equal(f.backend.autoInstallOnAppQuit, false);
    const saved = JSON.parse(
      await readFile(path.join(f.root, 'preferences', 'updates.json'), 'utf8'),
    );
    assert.equal(saved.channel, 'beta');
    const stable = new UpdateService({
      dataRoot: f.root,
      version: '1.2.0',
      enabled: false,
      backend: new Backend(),
      isRunActive: () => false,
      publish: () => {},
    });
    await stable.start();
    assert.equal(stable.getPreferences().channel, 'beta');
    stable.dispose();
  } finally {
    f.service.dispose();
  }
});

void test('update lifecycle publishes detached snapshots and removes listeners on shutdown', async () => {
  const f = await fixture();
  try {
    await f.service.start();
    await f.service.check();
    await f.service.check();
    assert.equal(f.backend.checks, 1);
    f.backend.emit('checking-for-update');
    f.backend.emit('update-available', { version: '1.2.0' });
    assert.equal(f.service.snapshot().state, 'available');
    await f.service.download();
    await f.service.download();
    assert.equal(f.backend.downloads, 1);
    f.backend.emit('download-progress', {
      percent: 110,
      transferred: 12,
      total: 12,
      bytesPerSecond: 1,
    });
    assert.equal(f.service.snapshot().progress?.percent, 100);
    const copy = f.service.snapshot();
    if (copy.progress) copy.progress.percent = 0;
    assert.equal(f.service.snapshot().progress?.percent, 100);
    f.backend.emit('update-downloaded', { version: '1.2.0' });
    assert.equal(f.service.snapshot().latestVersion, '1.2.0');
    await f.service.check();
    assert.equal(f.backend.checks, 1);
    f.setBusy(true);
    f.service.install();
    await nextTick();
    assert.equal(f.backend.installs, 0);
    assert.match(f.service.snapshot().message ?? '', /active assessment/);
    f.setBusy(false);
    f.service.install();
    f.setBusy(true);
    await nextTick();
    assert.equal(f.backend.installs, 0);
    f.setBusy(false);
    f.service.install();
    await nextTick();
    assert.equal(f.backend.installs, 1);
    const count = f.publications.length;
    f.service.dispose();
    assert.equal(f.backend.listenerCount('update-available'), 0);
    f.backend.emit('update-available', { version: '9.9.9' });
    await f.service.check();
    await f.service.download();
    f.service.install();
    assert.equal(f.publications.length, count);
  } finally {
    f.service.dispose();
  }
});

void test('update errors are redacted and retryable even without a backend error event', async () => {
  const f = await fixture();
  try {
    await f.service.start();
    f.backend.failure = true;
    await f.service.check();
    assert.equal(f.service.snapshot().state, 'error');
    assert.doesNotMatch(JSON.stringify(f.publications), /private|secret/);
    f.backend.emit('error', new Error('https://private.example/token'));
    f.backend.failure = false;
    await f.service.check();
    f.backend.emit('update-not-available');
    assert.equal(f.service.snapshot().state, 'up-to-date');
    f.backend.emit('update-available', { version: '1.2.0' });
    f.backend.failure = true;
    await f.service.download();
    assert.equal(f.service.snapshot().state, 'error');
    f.backend.failure = false;
    await f.service.download();
    assert.equal(f.backend.downloads, 2);
    for (const event of ['update-available', 'update-downloaded', 'download-progress']) {
      f.backend.emit(event, { malformed: true });
      assert.equal(f.service.snapshot().state, 'error');
    }
  } finally {
    f.service.dispose();
  }
});

void test('preferences are validated and serialized, and persistence failure keeps the last setting', async () => {
  const f = await fixture();
  try {
    await f.service.start();
    await assert.rejects(
      f.service.setPreferences({ autoDownload: true, channel: 'invalid' } as never),
    );
    await Promise.all([
      f.service.setPreferences({ autoDownload: false, channel: 'beta' }),
      f.service.setPreferences({ autoDownload: true, channel: 'stable' }),
    ]);
    assert.deepEqual(f.service.getPreferences(), { autoDownload: true, channel: 'stable' });
    f.backend.emit('update-available', { version: '1.2.0' });
    await f.service.setPreferences({ autoDownload: true, channel: 'stable' });
    assert.equal(f.backend.downloads, 1);
    await mkdir(path.join(f.root, 'preferences', 'updates.json.tmp'));
    await assert.rejects(f.service.setPreferences({ autoDownload: false, channel: 'stable' }));
    assert.equal(f.service.getPreferences().autoDownload, true);
  } finally {
    f.service.dispose();
  }
});
