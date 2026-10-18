import type {
  VerificationSettings,
  VerificationUpdate,
} from '../../../../packages/contracts/src/verification';
import { phoneVerificationVisible } from './verification-features';

/** Editable configuration; private inputs live only in memory until sent to the worker. */
export type VerificationDraft = {
  trigger: 'manual' | 'after_assessment';
  rememberCredentials: boolean;
  credentialStorage: 'keyring' | 'session' | undefined;
  browser: boolean;
  url: string;
  api: boolean;
  apiUrl: string;
  apiKey: string;
  apiKeyHeader: 'X-API-Key' | 'Authorization';
  apiKeyConfigured: boolean;
  webLogin: boolean;
  loginUrl: string;
  username: string;
  password: string;
  webCredentialsConfigured: boolean;
  writes: boolean;
  phone: boolean;
  connection: 'managed' | 'manual';
  deviceName: string;
  appName: string;
  serverUrl: string;
  udid: string;
  bundleId: string;
  buildLabel: string;
  interactions: boolean;
  phoneStepLimit: number;
};
/** Restore the project's saved settings or start with explicit manual verification. */
export function verificationDraft(
  settings: VerificationSettings = { url: null },
): VerificationDraft {
  return {
    trigger: settings.trigger ?? 'manual',
    rememberCredentials: settings.rememberCredentials ?? true,
    credentialStorage: settings.credentialStorage,
    browser: Boolean(settings.url),
    url: settings.url ?? '',
    api: Boolean(settings.api),
    apiUrl: settings.api ? settings.api.url : '',
    apiKey: '',
    apiKeyHeader: settings.api?.keyHeader ?? 'X-API-Key',
    apiKeyConfigured: !!settings.apiKeyConfigured,
    webLogin: !!settings.webLogin,
    loginUrl: settings.webLogin?.loginUrl ?? '',
    username: '',
    password: '',
    webCredentialsConfigured: !!settings.webCredentialsConfigured,
    writes: settings.api ? settings.api.allowMutations : false,
    ...phoneDraft(settings),
  };
}
/** Restore retained phone fields independently of the currently visible setup choices. */
function phoneDraft(settings: VerificationSettings) {
  const phone = settings.phone;
  const target = phone?.target;
  return {
    phone: phoneVerificationVisible() && Boolean(phone),
    connection: phone ? (phone.target.connection ?? 'manual') : 'managed',
    ...phoneNames(target),
    serverUrl: phone ? phone.target.serverUrl : 'http://127.0.0.1:4723',
    udid: phone ? phone.target.udid : '',
    bundleId: phone ? phone.target.bundleId : '',
    buildLabel: phone ? phone.buildLabel : '',
    interactions: Boolean(phone),
    phoneStepLimit: phone ? phone.stepLimit : 25,
  };
}
/** Convert the selected surfaces into a single worker-validated update without storing secrets. */
export function verificationUpdate(draft: VerificationDraft): VerificationUpdate {
  if (draft.browser && !draft.url.trim()) throw new Error('Enter the browser app URL.');
  if (draft.api && !draft.apiUrl.trim()) throw new Error('Enter the API base URL.');
  return {
    ...webUpdate(draft),
    ...((draft.browser && draft.webLogin) || draft.api
      ? { rememberCredentials: draft.rememberCredentials }
      : {}),
    ...(draft.api && draft.apiKey ? { apiKey: draft.apiKey } : {}),
    trigger: draft.trigger,
    url: draft.browser ? draft.url.trim() : null,
    api: draft.api
      ? { url: draft.apiUrl.trim(), allowMutations: draft.writes, keyHeader: draft.apiKeyHeader }
      : null,
    ...phoneUpdate(draft),
  };
}

/** Validate private form inputs separately from the public surface choice. */
function webUpdate(draft: VerificationDraft): VerificationUpdate {
  if (!draft.browser) return {};
  if (draft.webLogin && !draft.loginUrl.trim()) throw new Error('Enter the login page URL.');
  if (draft.webLogin && !!draft.username !== !!draft.password)
    throw new Error('Enter both the test username and password.');
  return {
    webLogin: draft.webLogin ? { loginUrl: draft.loginUrl.trim() } : null,
    ...(draft.webLogin && draft.username && draft.password
      ? { webCredentials: { username: draft.username, password: draft.password } }
      : {}),
  };
}
/** Preserve hidden phone configuration and validate it when the feature is restored. */
function phoneUpdate(draft: VerificationDraft): VerificationUpdate {
  if (draft.phone && (!draft.udid.trim() || !draft.bundleId.trim() || !draft.buildLabel.trim()))
    throw new Error('Enter the iPhone device ID, app identifier, and installed build label.');
  if (draft.phone && !draft.interactions)
    throw new Error('Allow interaction with the selected phone and test account before saving.');
  return {
    ...(phoneVerificationVisible()
      ? {
          phone: draft.phone
            ? {
                target: {
                  connection: draft.connection,
                  deviceName: draft.deviceName,
                  appName: draft.appName,
                  serverUrl: draft.serverUrl.trim(),
                  udid: draft.udid.trim(),
                  bundleId: draft.bundleId.trim(),
                },
                buildLabel: draft.buildLabel.trim(),
                allowInteractions: true,
                stepLimit: draft.phoneStepLimit,
              }
            : null,
        }
      : {}),
  };
}

/** Restore optional display labels without changing saved device identity. */
function phoneNames(target: NonNullable<VerificationSettings['phone']>['target'] | undefined) {
  return { deviceName: target?.deviceName ?? '', appName: target?.appName ?? '' };
}
