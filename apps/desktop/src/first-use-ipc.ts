import { ipcMain } from 'electron';
import { z } from 'zod/v3';

import type { IpcAuthorization } from './desktop-ipc.js';
import { FirstUsePreferences } from './first-use.js';

/** Expose only read and explicit completion to the trusted main frame, with no arbitrary preference writes. */
export function registerFirstUseIpc(authorized: IpcAuthorization, dataRoot: string): void {
  const preferences = new FirstUsePreferences(dataRoot);
  ipcMain.handle('guide:state', (event, input: unknown) => {
    authorized(event);
    z.undefined().parse(input);
    return preferences.read();
  });
  ipcMain.handle('guide:complete', (event, input: unknown) => {
    authorized(event);
    z.undefined().parse(input);
    return preferences.complete();
  });
}
