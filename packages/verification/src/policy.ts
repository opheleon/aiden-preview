import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { type VerificationConfig, VerificationConfigSchema } from '../../contracts/src/index.js';

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
      'Remove credentials from the URL. Use the verification settings file or environment variables instead.',
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

/** Read optional settings; credential files must be private, and environment credentials take precedence. */
export async function loadVerificationConfig(
  projectDir: string,
  env: NodeJS.ProcessEnv,
): Promise<VerificationConfig> {
  const file = settingsFile(projectDir);
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`${file} is not valid JSON.`, { cause: error });
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const config = VerificationConfigSchema.parse(raw);
  // Saving an app URL is how the user configures a non-local origin, so it joins the allowlist.
  if (config.url)
    config.allowedOrigins = [...config.allowedOrigins, parseAppUrl(config.url).origin];
  if (config.api) config.allowedOrigins.push(parseApiUrl(config.api.url).origin);
  if ((config.credentials || config.expiredToken) && ((await stat(file)).mode & 0o077) !== 0)
    throw new Error(`Run chmod 600 on ${file} before storing test credentials in it.`);
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
