import path from 'node:path';

import {
  type CallDraft,
  type RunManifest,
  type VerificationConfig,
  type VerificationSettings,
} from '../../contracts/src/index.js';
import { type VerificationUpdate } from '../../contracts/src/verification.js';
import {
  discoverLocalApps,
  type DiscoverOptions,
  loadVerificationConfig,
  verificationTarget,
} from '../../verification/src/index.js';
import {
  persistProjectVerification,
  readProjectVerification,
} from '../../verification/src/project-credentials.js';
import { appendActivity } from './activity.js';
import { recordCall } from './calls.js';
import { optionalJson } from './storage.js';
import { updatedVerificationConfig } from './verification-auth-settings.js';
import type { WorkflowContext } from './workflow-context.js';

/** Choose the given URL or the project's saved one, then apply the local-or-configured origin rule. */
export async function resolveVerifyUrl(projectDir: string, url?: string): Promise<string> {
  const config = await loadVerificationConfig(projectDir, process.env);
  const target = url ?? config.url ?? config.api?.url;
  if (!target)
    throw new Error(
      "Save this project's app URL (App URL on its overview, or the verify-url command), or pass --url.",
    );
  return verificationTarget(target, config.allowedOrigins).href;
}

/** Read the settings file as saved, without environment credentials or derived origins. */
async function savedSettings(projectDir: string): Promise<VerificationConfig> {
  return readProjectVerification(projectDir);
}

/** Read the project's saved app URL for display; test credentials never leave the worker. */
export async function readAppUrl(
  context: Pick<WorkflowContext, 'store'>,
  projectId: string,
): Promise<VerificationSettings> {
  const settings = await savedSettings(context.store.project(projectId));
  return {
    url: settings.url ?? null,
    ...(settings.credentialStorage ? { credentialStorage: settings.credentialStorage } : {}),
    ...(settings.rememberCredentials !== undefined
      ? { rememberCredentials: settings.rememberCredentials }
      : {}),
    ...(settings.webLogin
      ? {
          webLogin: settings.webLogin,
          webCredentialsConfigured:
            !!settings.credentials &&
            (!settings.credentialOrigin ||
              settings.credentialOrigin === new URL(settings.url!).origin),
        }
      : {}),
    ...(settings.api?.keyHeader
      ? { apiKeyConfigured: settings.apiKey?.origin === new URL(settings.api.url).origin }
      : {}),
    ...(settings.authRevision ? { authRevision: settings.authRevision } : {}),
    ...(settings.api ? { api: settings.api } : {}),
    ...(settings.phone ? { phone: settings.phone } : {}),
    ...(settings.trigger ? { trigger: settings.trigger } : {}),
    ...(settings.manual ? { manual: true } : {}),
  };
}

/** Save or clear the project's app URL while preserving unrelated configuration and credentials. */
export async function saveAppUrl(
  context: Pick<WorkflowContext, 'store'>,
  projectId: string,
  url: string | null,
): Promise<VerificationSettings> {
  return saveVerificationSettings(context, projectId, { url });
}

/** Save public verification settings in one write, preserving private credentials. */
export async function saveVerificationSettings(
  context: Pick<WorkflowContext, 'store'>,
  projectId: string,
  update: VerificationUpdate,
): Promise<VerificationSettings> {
  const projectDir = context.store.project(projectId);
  if (!(await optionalJson(path.join(projectDir, 'project.json'))))
    throw new Error('Save this project before setting its app URL.');
  return writeVerificationSettings(context, projectId, update);
}

/** Validate and atomically save setup under the caller's project lock, preserving private credentials. */
export async function writeVerificationSettings(
  context: Pick<WorkflowContext, 'store'>,
  projectId: string,
  input: VerificationUpdate,
): Promise<VerificationSettings> {
  const projectDir = context.store.project(projectId);
  const settings = updatedVerificationConfig(await savedSettings(projectDir), input);
  await persistProjectVerification(projectDir, settings);
  return readAppUrl(context, projectId);
}

/** The call Aiden records when it cannot tell where the app runs; it keeps checking the code meanwhile. */
function appUrlCall(found: string[]): CallDraft {
  const base = { requirementId: null, edgeCaseId: null, owner: 'you' as const };
  return found.length
    ? {
        ...base,
        question: 'Which URL opens this project’s app? Confirm a suggested page or enter its URL.',
        options: found.slice(0, 4),
        assumption: 'Checking the code only until you pick one.',
      }
    : {
        ...base,
        question: 'Where does your app run? No app page was identified; enter its URL.',
        options: [],
        assumption: 'Checking the code only until the app is running.',
      };
}

/**
 * Make sure Aiden knows where the app runs before a browser check. A saved URL wins. Otherwise
 * Aiden suggests successful HTML pages on localhost without starting anything. Even a single
 * page needs confirmation: an HTTP response does not establish product identity. Until then,
 * the look continues on code alone. Previously saved URLs remain compatible.
 */
export async function findRunningApp(
  context: Pick<WorkflowContext, 'store' | 'emit'>,
  run: Pick<RunManifest, 'id' | 'projectId' | 'project'>,
  options?: DiscoverOptions,
): Promise<string | null> {
  const settings = await readAppUrl(context, run.projectId);
  const saved = settings.url ?? settings.api?.url;
  if (saved) return saved;
  const found = await discoverLocalApps(
    run.project.repositories.map((r) => r.path),
    options,
  );
  const { call, created } = await recordCall(
    context.store,
    run.projectId,
    appUrlCall(found),
    'app-url',
    run.id,
  );
  if (created)
    await appendActivity(context, run, {
      kind: 'ask',
      summary: `Asked you: ${call.question}`,
      reason: found.length
        ? `Local web pages answered (${found.join(', ')}), but their project identity is unconfirmed. ${call.assumption}`
        : `No successful HTML page answered on the candidate ports. An API error or redirect does not identify your app. ${call.assumption}`,
    });
  return null;
}
