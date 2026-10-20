import type { Project } from '../../contracts/src/index.js';
import type { VerificationUpdate } from '../../contracts/src/verification.js';
import type { VerificationConfig } from '../../contracts/src/verification.js';
import { VerificationUpdateSchema } from '../../contracts/src/verification.js';
import { validateProjectRepositories } from '../../tools/src/discovery.js';
import { privateBrowserLogin } from '../../verification/src/browser-login.js';
import {
  ApiHttp,
  launchBrowser,
  loadVerificationConfig,
  parseAppUrl,
} from '../../verification/src/index.js';
import { configuredApiKey } from '../../verification/src/policy.js';
import type { Engine } from './engine.js';
import { readSetupState, writeSetupState } from './guide-context.js';
import { verificationAccessKeys } from './verification-access.js';
import { updatedVerificationConfig } from './verification-auth-settings.js';
import { readAppUrl, saveVerificationSettings } from './verification-settings.js';

/** Check a public URL without credentials, browser automation, or API writes. */
export async function testAppUrl(raw: string): Promise<{ reachable: boolean; message: string }> {
  const url = parseAppUrl(raw.trim());
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel().catch(() => {});
    return response.ok
      ? { reachable: true, message: `${url.host} answered successfully (HTTP ${response.status}).` }
      : {
          reachable: false,
          message: `${url.host} returned HTTP ${response.status}. Use an accessible app or API address before continuing.`,
        };
  } catch {
    return {
      reachable: false,
      message: `Nothing answered at ${url.host}. Start the app and check the address, then try again.`,
    };
  }
}

/**
 * Prove access before confirming setup. Failed probes leave saved configuration untouched.
 * Saving rechecks the exact supplied targets, then records evidence tied to their configuration.
 * A phone probe opens the selected installed app and releases its automation session.
 */
export async function configureGuideVerification(
  engine: Engine,
  projectId: string,
  input: VerificationUpdate,
  save: boolean,
  code?: Project,
): Promise<{ message: string }> {
  const update = VerificationUpdateSchema.parse(input);
  if (code) {
    if (code.id !== projectId || !code.repositories.length)
      throw new Error('Choose this project’s code folder before checking access.');
    try {
      await validateProjectRepositories(code);
    } catch {
      throw new Error(
        'The code folder is unavailable or is not a committed Git repository. Choose the folder again before confirming.',
      );
    }
  }
  const config = updatedVerificationConfig(
    await loadVerificationConfig(engine.store.project(projectId), process.env),
    update,
  );
  if (update.url) {
    if (config.webLogin) await checkPrivateLogin(config);
    else {
      const result = await testAppUrl(update.url);
      if (!result.reachable) throw new Error(`Web app: ${result.message}`);
    }
  }
  if (update.api) await checkApiAccess(config);
  if (update.phone) {
    try {
      await engine.devices.probe(update.phone.target);
    } catch {
      throw new Error(
        'iPhone access failed. Unlock the phone, check pairing and Apple signing, and try again. Setup has not been confirmed.',
      );
    }
  }
  let storageNote = '';
  if (save) {
    const saved = await saveVerificationSettings(engine, projectId, update);
    if (saved.credentialStorage === 'session')
      storageNote =
        ' Test credentials are in memory for this session only. Enter them again after Aiden closes.';
    const state = await readSetupState(engine.store, projectId);
    const keys = verificationAccessKeys(await readAppUrl(engine, projectId));
    const checked = Object.fromEntries(
      Object.entries(keys).filter(
        ([method]) =>
          (method === 'web' && !!update.url) ||
          (method === 'api' && !!update.api) ||
          (method === 'phone' && !!update.phone),
      ),
    );
    await writeSetupState(engine.store, projectId, {
      ...state,
      checksConfirmedAt: new Date().toISOString(),
      verifiedTargets: Object.fromEntries(
        Object.entries({ ...state.verifiedTargets, ...checked }).filter(
          ([method, key]) => keys[method] === key,
        ),
      ),
    });
  }
  return { message: setupMessage(update, save, storageNote) };
}

/** Report a confirmed choice without claiming an access probe for local code or manual checks. */
function setupMessage(update: VerificationUpdate, save: boolean, storageNote: string): string {
  const checked = !!(update.url || update.api || update.phone);
  if (!save)
    return checked ? 'Access checked. You can confirm this setup.' : 'Ready to confirm setup.';
  return (
    (checked
      ? 'Access checked and verification setup confirmed.'
      : 'Verification setup confirmed.') + storageNote
  );
}

/** Verify login with a real browser and a fresh cookie-only context before accepting setup. */
async function checkPrivateLogin(config: VerificationConfig): Promise<void> {
  const browser = await launchBrowser();
  try {
    const target = parseAppUrl(config.url!);
    await privateBrowserLogin(browser, target, config);
  } finally {
    await browser.close();
  }
}

/** Require a protected API endpoint to reject missing keys and accept the configured key. */
async function checkApiAccess(config: VerificationConfig): Promise<void> {
  const key = configuredApiKey(config);
  if (!key) {
    const result = await testAppUrl(config.api!.url);
    if (!result.reachable) throw new Error(`API: ${result.message}`);
    return;
  }
  const http = new ApiHttp(
    config.api!.url,
    false,
    AbortSignal.timeout(15000),
    undefined,
    undefined,
    key,
  );
  const request = {
    method: 'GET' as const,
    path: config.api!.url,
    body: null,
    bearer: null,
    reason: 'Check API access',
  };
  try {
    const denied = await http.request(request);
    if (![401, 403].includes(denied.status))
      throw new Error('Choose a protected API endpoint that rejects requests without a key.');
    const accepted = await http.request({ ...request, bearer: '@secret:apiKey' });
    if (accepted.status < 200 || accepted.status >= 300)
      throw new Error('The API rejected this key. Check its permissions and try again.');
  } catch (error) {
    // Keep the original error out of the cause chain because it may contain the private key.
    const message = http.redact(
      error instanceof Error ? error.message : 'Could not check API access.',
    );
    // eslint-disable-next-line preserve-caught-error -- A raw cause can contain the private API key and must not cross the worker boundary.
    throw new Error(message);
  }
}
