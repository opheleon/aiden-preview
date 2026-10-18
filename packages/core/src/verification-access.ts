import type { VerificationSettings } from '../../contracts/src/verification.js';
import { hash } from './storage.js';

/** Bind a successful access check to the exact public target so changed settings need a fresh check. */
export function verificationAccessKeys(settings: VerificationSettings): Record<string, string> {
  const keys: Record<string, string> = {};
  if (settings.url)
    keys.web = hash(
      JSON.stringify({
        url: new URL(settings.url).href,
        login: settings.webLogin,
        credentialsAvailable: settings.webCredentialsConfigured,
        auth: settings.authRevision,
      }),
    );
  if (settings.api)
    keys.api = hash(
      JSON.stringify({
        ...settings.api,
        credentialsAvailable: settings.apiKeyConfigured,
        url: new URL(settings.api.url).href,
        auth: settings.authRevision,
      }),
    );
  if (settings.phone) keys.phone = hash(JSON.stringify(settings.phone));
  return keys;
}
