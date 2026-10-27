import { ipcMain, shell } from 'electron';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../packages/contracts/src/api.js';
import { teamsAuth } from '../../../packages/contracts/src/teams-auth.js';
import type { WorkerClient } from '../../../packages/core/src/client.js';
import type { IpcAuthorization } from './desktop-ipc.js';
const methods = new Set([
  'accountStatus',
  'accountSignIn',
  'accountSignOut',
  'accountState',
  'accountTakeTask',
  'accountFinishTask',
  'accountSetPickup',
  'accountCreateProject',
  'accountShareProject',
  'accountSyncSetup',
  'accountCancelTask',
  'accountRetryTask',
  'projects',
  'guide',
  'askGuide',
  'guideEvent',
  'configureGuideVerification',
  'confirmRequirements',
  'skipSetupStep',
  'testAppUrl',
  'phoneSetup',
  'savePhoneSetup',
  'phoneApps',
  'deviceProbe',
  'deviceTest',
  'deviceRuns',
  'deviceRun',
  'deviceCancel',
  'acceptOutcome',
  'closeProject',
  'reopenProject',
  'linearTeams',
  'publishLinearTickets',
  'ticketState',
  'ticketCapabilities',
  'saveTicketSettings',
  'syncTickets',
  'codingJobs',
  'startCoding',
  'cancelCoding',
  'reconcileDelivery',
  'betaSettings',
  'updateBetaSettings',
  'state',
  'prepare',
  'approve',
  'report',
  'resume',
  'cancel',
  'candidate',
  'result',
  'evidence',
  'diagnostics',
  'models',
  'setKey',
  'login',
  'updateRuntime',
  'integrations',
  'integrationPreset',
  'integrationAdd',
  'integrationConnect',
  'integrationTools',
  'integrationApprove',
  'integrationCall',
  'integrationDisconnect',
  'integrationRemove',
  'updateSources',
  'connectCode',
  'estimate',
  'estimation',
  'estimateOverrides',
  'verify',
  'verification',
  'verificationSettings',
  'updateVerificationSettings',
  'look',
  'activity',
  'calls',
  'answerCall',
  'editIntent',
  'heads',
  'monitoring',
  'remoteBranches',
  'updateMonitoredBranch',
  'runLog',
  'confirmations',
  'confirmAction',
  'chat',
  'explain',
  'askWhy',
]);

/** Open Teams sign-in only on the configured Auth0 tenant's own HTTPS host. */
async function openTeamsSignIn(r: WorkerResult<WorkerMethod>): Promise<void> {
  if (!r || typeof r !== 'object' || !('authUrl' in r) || typeof r.authUrl !== 'string') return;
  const url = new URL(r.authUrl);
  const tenant = new URL(teamsAuth(process.env).issuer);
  if (url.protocol !== 'https:' || url.host !== tenant.host)
    throw new Error('Unexpected sign-in URL.');
  await shell.openExternal(url.href);
}

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
  if (method === 'accountSignIn') return openTeamsSignIn(r);
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
export function registerWorkerIpc(
  authorized: IpcAuthorization,
  worker: WorkerClient,
  onAccountChange: () => void = () => {},
): void {
  // A browser sign-in finishes outside any request; the Teams screen's status checks reveal it.
  let signedIn: boolean | undefined;
  ipcMain.handle('aiden:request', async (event, method: WorkerMethod, params: unknown) => {
    authorized(event);
    if (!methods.has(method)) throw new Error('Operation not allowed.');
    const r = await worker.request(method, params as WorkerParams<WorkerMethod>);
    await openAuthorization(method, r);
    // Ask for work right away after anything that can change what this machine should do.
    if (['accountSetPickup', 'accountCreateProject', 'accountShareProject'].includes(method))
      onAccountChange();
    if (method === 'accountStatus') {
      const now = (r as WorkerResult<'accountStatus'>).signedIn;
      if (signedIn !== undefined && signedIn !== now) onAccountChange();
      signedIn = now;
    }
    return r;
  });
}
