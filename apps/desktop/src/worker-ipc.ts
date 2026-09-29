import { ipcMain, shell } from 'electron';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../packages/contracts/src/api.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';
import type { IpcAuthorization } from './desktop-ipc.js';
const methods = new Set([
  'discoverRepositories',
  'projects',
  'state',
  'prepare',
  'approve',
  'report',
  'resume',
  'cancel',
  'answer',
  'candidate',
  'result',
  'evidence',
  'diagnostics',
  'models',
  'setKey',
  'login',
  'updateRuntime',
  'integrations',
  'integrationAdd',
  'integrationConnect',
  'integrationTools',
  'integrationApprove',
  'integrationCall',
  'integrationDisconnect',
  'integrationRemove',
  'updateSources',
  'estimate',
  'estimation',
  'estimateOverrides',
  'verify',
  'verification',
  'verificationSettings',
  'updateVerificationSettings',
]);

/** Open only approved provider login destinations or HTTPS integration authorization pages. */
async function openAuthorization(
  method: WorkerMethod,
  r: WorkerResult<WorkerMethod>,
): Promise<void> {
  if (method === 'login' && r && typeof r === 'object' && 'authUrl' in r && r.authUrl) {
    const u = new URL(r.authUrl);
    if (
      u.protocol !== 'https:' ||
      !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(u.hostname)
    )
      throw new Error('Unexpected provider login URL.');
    await shell.openExternal(u.href);
  }
  if (
    method === 'integrationConnect' &&
    r &&
    typeof r === 'object' &&
    'authUrl' in r &&
    r.authUrl
  ) {
    const u = new URL(String(r.authUrl));
    if (u.protocol !== 'https:') throw new Error('Unexpected MCP authorization URL.');
    await shell.openExternal(u.href);
  }
}
/** Forward allowlisted renderer operations to the worker, whose dispatch validates every payload. */
export function registerWorkerIpc(authorized: IpcAuthorization, worker: WorkerClient): void {
  ipcMain.handle('aiden:request', async (event, method: WorkerMethod, params: unknown) => {
    authorized(event);
    if (!methods.has(method)) throw new Error('Operation not allowed.');
    const r = await worker.request(method, params as WorkerParams<WorkerMethod>);
    await openAuthorization(method, r);
    return r;
  });
}
