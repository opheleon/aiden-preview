import path from 'node:path';

import type { VerificationConfig } from '../../contracts/src/index.js';
import { readProjectVerification } from './project-credentials.js';

const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Loopback and `.localhost` hosts are always testable because they cannot reach a shared environment. */
export function isLocalHost(hostname: string): boolean {
  return loopback.has(hostname) || hostname.endsWith('.localhost');
}

/** Worker-only settings file beside the project's other private Aiden state. */
export function settingsFile(projectDir: string): string {
  return path.join(projectDir, 'verification.json');
}

/** Parse an http(s) app address without embedded credentials; origin policy is checked separately. */
export function parseAppUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a full URL such as http://localhost:3000.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Only http and https URLs can be verified.');
  if (url.username || url.password)
    throw new Error(
      'Remove credentials from the URL. Use the private verification form or environment variables instead.',
    );
  return url;
}

/** Parse an API base without URL-carried secrets or ambiguous query/fragment routing. */
export function parseApiUrl(raw: string): URL {
  const url = parseAppUrl(raw.trim());
  if (url.search || url.hash)
    throw new Error('Use an API base URL without query parameters or fragments.');
  return url;
}

/** Accept only http(s) targets on loopback or an exact origin the user configured for the project. */
export function verificationTarget(raw: string, allowedOrigins: readonly string[]): URL {
  const url = parseAppUrl(raw);
  if (!isLocalHost(url.hostname) && !allowedOrigins.some((o) => new URL(o).origin === url.origin))
    throw new Error(
      `${url.origin} is not allowed. Use a localhost URL, or save it as this project's app URL (App URL on its overview).`,
    );
  return url;
}

/** Load project credentials from secure storage or memory, then apply explicit environment overrides. */
export async function loadVerificationConfig(
  projectDir: string,
  env: NodeJS.ProcessEnv,
): Promise<VerificationConfig> {
  const config = await readProjectVerification(projectDir);
  // Saving an app URL is how the user configures a non-local origin, so it joins the allowlist.
  if (config.url)
    config.allowedOrigins = [...config.allowedOrigins, parseAppUrl(config.url).origin];
  if (config.api) config.allowedOrigins.push(parseApiUrl(config.api.url).origin);
  if (config.credentialsForgotten) return config;
  const username = env.AIDEN_VERIFY_USERNAME;
  const password = env.AIDEN_VERIFY_PASSWORD;
  if (username && password) config.credentials = { username, password };
  else if (username || password)
    throw new Error('Set both AIDEN_VERIFY_USERNAME and AIDEN_VERIFY_PASSWORD, or neither.');
  if (env.AIDEN_VERIFY_EXPIRED_TOKEN) config.expiredToken = env.AIDEN_VERIFY_EXPIRED_TOKEN;
  return config;
}

/** Replace each secret wherever it appears; longer values go first so overlapping secrets stay hidden. */
export function redactor(secrets: readonly string[]): (text: string) => string {
  const values = secrets.filter(Boolean).sort((a, b) => b.length - a.length);
  return (text) =>
    values.reduce((out, secret) => out.split(secret).join('[test credential]'), text);
}

/** Resolve an API key only for the origin to which the person explicitly supplied it. */
export function configuredApiKey(
  config: VerificationConfig,
): { value: string; header: 'X-API-Key' | 'Authorization' } | undefined {
  if (!config.api?.keyHeader) return undefined;
  if (!config.apiKey || config.apiKey.origin !== new URL(config.api.url).origin)
    throw new Error('Enter an API key for this API before checking access.');
  return { value: config.apiKey.value, header: config.api.keyHeader };
}
