import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IpcMainInvokeEvent } from 'electron';
import { expect, test, vi } from 'vitest';

const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, input?: unknown) => unknown>(),
);
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: IpcMainInvokeEvent, input?: unknown) => unknown) =>
      handlers.set(name, handler),
  },
}));
const { registerFirstUseIpc } = await import('../../apps/desktop/src/first-use-ipc');

test('guide IPC rejects untrusted callers and arbitrary payloads before reading or saving preferences', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-guide-ipc-'));
  const trusted = {} as IpcMainInvokeEvent;
  registerFirstUseIpc((event) => {
    if (event !== trusted) throw new Error('Untrusted IPC sender.');
  }, root);
  const file = path.join(root, 'preferences/first-use.json');
  try {
    for (const name of ['guide:state', 'guide:complete']) {
      const handler = handlers.get(name)!;
      expect(() => handler({} as IpcMainInvokeEvent)).toThrow('Untrusted IPC sender');
      expect(() => handler(trusted, { path: '/tmp/elsewhere', completed: true })).toThrow();
    }
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(handlers.get('guide:state')!(trusted)).resolves.toEqual({
      completed: false,
      issue: null,
    });
    await expect(handlers.get('guide:complete')!(trusted)).resolves.toEqual({
      completed: true,
      issue: null,
    });
    expect(JSON.parse(await readFile(file, 'utf8')).completedAt).toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
