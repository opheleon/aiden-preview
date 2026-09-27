/** Pass only process prerequisites and network trust settings, excluding unrelated credentials. */
export function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
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
    ].flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])),
  );
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
    return JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    );
  } catch (cause) {
    throw new ArtifactFormatError('The output must be a single valid JSON object.', { cause });
  }
}
