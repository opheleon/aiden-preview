import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Keep a port only when it is a usable, unprivileged TCP port. */
const usablePort = (port: number): boolean =>
  Number.isInteger(port) && port >= 1024 && port <= 65535;

/** Ports common local dev servers listen on, tried after any port the project's scripts name. */
export const commonPorts: readonly number[] = [3000, 3001, 4200, 5173, 5174, 8000, 8080];

/** Largest package.json Aiden reads for port hints; anything bigger is not a normal manifest. */
const maxManifestBytes = 512 * 1024;

/** Most ports probed in one discovery, so a manifest full of numbers cannot fan out requests. */
const maxProbes = 16;

/** Port flags and variables dev scripts use: `--port 5173`, `--port=5173`, `-p 3001`, `PORT=4000`. */
const portPattern = /(?:--port[= ]|(?:^|\s)-p\s+|\bPORT=)(\d{2,5})\b/g;

/** Options for probing; tests inject `fetch` so no socket is opened. */
export type DiscoverOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Default ports to try after script hints, replacing `commonPorts`; empty tries hints only. */
  ports?: readonly number[];
};

/**
 * Read the default ports from `AIDEN_APP_PORTS`, a comma-separated list such as "3000,5173".
 * Unset keeps the common defaults; an empty value tries only ports the project's scripts name.
 */
export function appPorts(value: string | undefined): readonly number[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter(usablePort);
}

/**
 * Read port numbers named in a repository's package.json scripts. The file is evidence only: it is
 * parsed as JSON, never run, and symlinks or oversized files are skipped.
 */
async function manifestPorts(repoPath: string): Promise<number[]> {
  const file = path.join(repoPath, 'package.json');
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > maxManifestBytes) return [];
    const manifest = JSON.parse(await readFile(file, 'utf8')) as { scripts?: unknown };
    const scripts = manifest.scripts;
    if (!scripts || typeof scripts !== 'object') return [];
    return Object.values(scripts).flatMap((script) =>
      typeof script === 'string'
        ? [...script.matchAll(portPattern)].map((m) => Number(m[1])).filter(usablePort)
        : [],
    );
  } catch {
    return [];
  }
}

/** Ports to probe: script hints first in repository order, then the defaults, without repeats. */
export async function candidatePorts(
  repoPaths: readonly string[],
  defaults: readonly number[] = commonPorts,
): Promise<number[]> {
  const hinted = (await Promise.all(repoPaths.map(manifestPorts))).flat();
  return [...new Set([...hinted, ...defaults])].slice(0, maxProbes);
}

/** Suggest only successful HTML pages; API errors and redirects do not identify an app UI. */
async function answers(
  port: number,
  options: Required<Pick<DiscoverOptions, 'fetch' | 'timeoutMs'>>,
): Promise<boolean> {
  try {
    const response = await options.fetch(`http://localhost:${port}/`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    await response.body?.cancel();
    return response.ok && /^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '');
  } catch {
    return false;
  }
}

/**
 * Find candidate web pages, without establishing which product they belong to. Only `localhost` is
 * probed, with one HEAD request per candidate port; nothing is started. Returns app URLs in
 * preference order: ports named by the project's own scripts come first.
 */
export async function discoverLocalApps(
  repoPaths: readonly string[],
  options: DiscoverOptions = {},
): Promise<string[]> {
  const resolved = { fetch: options.fetch ?? fetch, timeoutMs: options.timeoutMs ?? 1500 };
  const ports = await candidatePorts(repoPaths, options.ports);
  const live = await Promise.all(ports.map((port) => answers(port, resolved)));
  return ports.filter((_, i) => live[i]).map((port) => `http://localhost:${port}/`);
}
