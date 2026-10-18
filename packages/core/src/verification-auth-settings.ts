import { randomUUID } from 'node:crypto';

import {
  ApiVerificationSchema,
  type VerificationConfig,
  type VerificationUpdate,
  VerificationUpdateSchema,
} from '../../contracts/src/verification.js';
import { parseApiUrl, parseAppUrl } from '../../verification/src/policy.js';

/** Merge private inputs only in the worker; bind saved secrets to their explicitly selected origin. */
export function applyVerificationAuth(
  settings: VerificationConfig,
  update: VerificationUpdate,
): void {
  updateWebLogin(settings, update);
  clearUnusedApiCredentials(settings, update);
  if (update.rememberCredentials !== undefined)
    settings.rememberCredentials = update.rememberCredentials;
  if (settings.webLogin) {
    if (
      !settings.url ||
      parseAppUrl(settings.webLogin.loginUrl).origin !== new URL(settings.url).origin
    )
      throw new Error('The login page and signed-in app must use the same origin.');
  }
  if (update.webCredentials) {
    if (!settings.url || !settings.webLogin)
      throw new Error('Choose a web app and login page first.');
    settings.credentials = update.webCredentials;
    settings.credentialOrigin = new URL(settings.url).origin;
  }
  if (update.apiKey !== undefined) {
    if (!settings.api?.keyHeader) throw new Error('Choose an API URL and API key header first.');
    settings.apiKey = { origin: new URL(settings.api.url).origin, value: update.apiKey };
  }
  if (update.webCredentials || update.apiKey !== undefined) {
    settings.authRevision = randomUUID();
    delete settings.credentialsForgotten;
  }
}

/** Remove API secrets when their target or key authentication is removed. */
function clearUnusedApiCredentials(settings: VerificationConfig, update: VerificationUpdate): void {
  if (
    update.api === null ||
    (update.api && !update.api.keyHeader) ||
    (settings.apiKey && settings.api && settings.apiKey.origin !== new URL(settings.api.url).origin)
  ) {
    delete settings.apiKey;
    delete settings.expiredToken;
  }
}

/** Clear private browser credentials with their login configuration, preventing legacy fallback. */
function updateWebLogin(settings: VerificationConfig, update: VerificationUpdate): void {
  if (update.url === null || update.webLogin === null) {
    delete settings.credentials;
    delete settings.credentialOrigin;
    delete settings.webLogin;
  }
  if (
    settings.credentialOrigin &&
    settings.url &&
    settings.credentialOrigin !== new URL(settings.url).origin
  ) {
    delete settings.credentials;
    delete settings.credentialOrigin;
  }
  if (update.webLogin !== undefined && update.url !== null) {
    delete settings.webLogin;
    if (update.webLogin) settings.webLogin = update.webLogin;
  }
}

/** Prepare a validated candidate without saving, allowing setup to prove access before committing. */
export function updatedVerificationConfig(
  saved: VerificationConfig,
  input: VerificationUpdate,
): VerificationConfig {
  const settings = structuredClone(saved);
  const update = VerificationUpdateSchema.parse({
    ...input,
    ...(typeof input.url === 'string' ? { url: input.url.trim() } : {}),
  });
  for (const field of ['phone', 'url', 'api'] as const)
    if (update[field] !== undefined) delete settings[field];
  if (update.phone) settings.phone = update.phone;
  if (update.url) settings.url = parseAppUrl(update.url.trim()).href;
  if (update.api)
    settings.api = ApiVerificationSchema.parse({
      ...update.api,
      url: parseApiUrl(update.api.url).href,
    });
  if (update.trigger !== undefined) settings.trigger = update.trigger;
  if (update.manual !== undefined) settings.manual = update.manual;
  applyVerificationAuth(settings, update);
  return settings;
}
