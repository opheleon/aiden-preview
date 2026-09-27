import type { HistoryIssue } from '../../contracts/src/index.js';

/** View only plain object-like input; external MCP results are never trusted as typed data. */
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Prefer structured MCP output, falling back to a JSON text block without executing its content. */
export function externalPayload(value: unknown): unknown {
  const object = record(value);
  if (object?.structuredContent !== undefined) return object.structuredContent;
  const content = object?.content;
  const text = Array.isArray(content)
    ? content.map(record).find((part) => part?.type === 'text')?.text
    : undefined;
  if (typeof text !== 'string') return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

/** Locate a bounded conventional record container; stop at 20 levels to reject pathological nesting. */
export function recordArray(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  const object = record(value);
  if (!object || depth >= 20) return [];
  for (const key of ['issues', 'nodes', 'items', 'results', 'records', 'data']) {
    const found = recordArray(object[key], depth + 1);
    if (found.length) return found;
  }
  return [];
}

/** Recognize supported opaque pagination cursors without inventing one for malformed output. */
export function nextCursor(value: unknown): string | null {
  const object = record(value);
  if (!object) return null;
  for (const key of ['nextCursor', 'next_cursor', 'cursor']) {
    const cursor = object[key];
    if (typeof cursor === 'string' && cursor) return cursor;
  }
  const page = record(object.pageInfo);
  return page?.hasNextPage === true && typeof page.endCursor === 'string' ? page.endCursor : null;
}

/** Require an explicit end marker or a short bounded page before claiming complete history. */
export function paginationComplete(
  value: unknown,
  returned: number,
  requested: number | null,
): boolean {
  const object = record(value);
  if (record(object?.pageInfo)?.hasNextPage === false) return true;
  for (const key of ['nextCursor', 'next_cursor']) {
    if (object && key in object && (object[key] === null || object[key] === '')) return true;
  }
  return requested !== null && returned < requested;
}

/** Parse a provider timestamp; malformed or missing values cannot establish observed duration. */
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** Accept stable textual IDs while rejecting objects that would stringify to misleading labels. */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

/** Historical evidence before the model applies a work-size classification. */
export type UnclassifiedHistory = Omit<HistoryIssue, 'size' | 'points' | 'workType' | 'scopeShape'>;

/** Normalize bounded tracker records and report malformed/duplicate evidence instead of guessing. */
export function normalizedHistory(
  rows: unknown[],
  connectionId: string,
  sourceId: string,
): {
  rows: UnclassifiedHistory[];
  limitations: string[];
} {
  const limitations: string[] = [];
  const seen = new Set<string>();
  const normalized: UnclassifiedHistory[] = [];
  for (const value of rows) {
    const row = record(value) ?? {};
    const id = text(row.id);
    const identifier = text(row.identifier ?? row.key ?? id);
    const title = text(row.title ?? row.name);
    if (!id || !identifier || !title || seen.has(id)) {
      limitations.push(
        id && seen.has(id)
          ? `Duplicate historical record ${id} was ignored.`
          : 'A malformed historical record was ignored.',
      );
      continue;
    }
    seen.add(id);
    normalized.push(normalizeRecord(row, { connectionId, sourceId, id, identifier, title }));
  }
  return { rows: normalized, limitations };
}

/** Preserve valid tracker identity and timestamps without inventing missing duration or URL evidence. */
function normalizeRecord(
  row: Record<string, unknown>,
  identity: Pick<UnclassifiedHistory, 'connectionId' | 'sourceId' | 'id' | 'identifier' | 'title'>,
): UnclassifiedHistory {
  const startedAt = timestamp(row.startedAt ?? row.started_at ?? row.startDate);
  const completedAt = timestamp(row.completedAt ?? row.completed_at ?? row.completionDate);
  const days =
    startedAt && completedAt && completedAt >= startedAt
      ? (Date.parse(completedAt) - Date.parse(startedAt)) / 86_400_000
      : null;
  return {
    ...identity,
    description: text(row.description),
    ...(typeof row.url === 'string' && /^https?:\/\//.test(row.url) ? { url: row.url } : {}),
    startedAt,
    completedAt,
    observedCalendarDays: days,
  };
}
