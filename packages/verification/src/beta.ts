/** Restrict scheduled product checks to the explicitly configured deployed beta. */
export function betaUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    /^(localhost|127\.|0\.|\[::1\])/.test(url.hostname) ||
    url.hostname.endsWith('.localhost')
  )
    throw new Error('Scheduled verification requires an HTTPS beta deployment, not localhost.');
  return url;
}
/** Bind every configured check target to the deployment whose revision we can prove. */
export function betaTarget(
  settings: { url?: string | null | undefined; api?: { url: string } | undefined },
  revisionUrl: string,
): URL {
  const target = betaUrl(settings.url ?? settings.api?.url ?? '');
  const urls = [revisionUrl, settings.url, settings.api?.url].filter((value): value is string =>
    Boolean(value),
  );
  if (!revisionUrl || urls.some((value) => betaUrl(value).origin !== target.origin))
    throw new Error('Beta app, API, and revision endpoint must use the same origin.');
  return target;
}
/** Read a small revision response, refusing redirects, oversized output and malformed commits. */
export async function deployedRevision(url: string): Promise<string> {
  betaUrl(url);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 4096)
    throw new Error('Beta revision endpoint is unavailable.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Beta revision response is empty.');
  let content = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      content += new TextDecoder().decode(chunk.value);
      if (content.length > 4096) throw new Error('Beta revision response is too large.');
    }
  } finally {
    await reader.cancel();
  }
  const value = JSON.parse(content) as { commit?: unknown };
  if (typeof value.commit !== 'string' || !/^[a-f0-9]{40,64}$/.test(value.commit))
    throw new Error('Beta revision endpoint must return a full commit SHA.');
  return value.commit;
}
