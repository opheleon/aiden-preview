/**
 * Pass only process prerequisites and network trust settings, excluding unrelated credentials.
 * Finder does not inherit shell setup. Append standard macOS CLI locations without evaluating
 * shell profiles, preserving explicitly configured PATH precedence for providers and Node wrappers.
 */
export function cleanEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    [
      'PATH',
      'HOME',
      'USER',
      'TMPDIR',
      'LANG',
      'SSL_CERT_FILE',
      'NODE_EXTRA_CA_CERTS',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'NO_PROXY',
    ].flatMap((k) => (source[k] ? [[k, source[k]]] : [])),
  );
  if (platform === 'darwin') {
    const inherited = (env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean);
    env.PATH = [...new Set([...inherited, '/opt/homebrew/bin', '/usr/local/bin'])].join(':');
  }
  return env;
}
/** Bound user-facing failure text and redact common API-key and bearer-token forms. */
export function publicError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e))
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 2000);
}
/** Distinguish malformed structured output from execution or authentication failures. */
export class ArtifactFormatError extends Error {}
/** Accept plain JSON or one fenced JSON block; invalid output never becomes an accepted report. */
export function parseJson(text: string): unknown {
  try {
    let content = text.trim();
    if (content.startsWith('```') && content.endsWith('```')) {
      const prefixLength = content.startsWith('```json') ? 7 : 3;
      content = content.slice(prefixLength, -3).trim();
    }
    return JSON.parse(content);
  } catch (cause) {
    throw new ArtifactFormatError('The output must be a single valid JSON object.', { cause });
  }
}
