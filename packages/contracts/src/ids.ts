import { z } from 'zod/v3';

/** Stable requirement identifier; numbers are never reused once retired. */
export const requirementId = z.string().regex(/^REQ-[1-9]\d*$/);
/** Edge-case identifier, unique within its requirement. */
export const edgeCaseId = z.string().regex(/^E[1-9]\d*$/);

/** List IDs for a correction message, or say so when there are none. */
const listIds = (ids: string[]): string => (ids.length ? ids.join(', ') : 'none');

/**
 * Require a model answer to name each expected ID exactly once and nothing else. The error starts
 * with `task` and then names the expected, missing, unexpected, and repeated IDs, so the next
 * correction knows exactly what to change instead of repeating the same answer.
 * Example: expected REQ-1, REQ-2 and returned REQ-1, REQ-6 throws
 * "<task> Expected: REQ-1, REQ-2. Missing: REQ-2. Not expected: REQ-6."
 */
export function requireExactIds(task: string, expected: string[], returned: string[]): void {
  const wanted = new Set(expected);
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of returned) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  const missing = [...wanted].filter((value) => !seen.has(value));
  const unexpected = [...seen].filter((value) => !wanted.has(value));
  if (!missing.length && !unexpected.length && !repeated.size) return;
  const parts = [`${task} Expected: ${listIds([...wanted])}.`];
  if (missing.length) parts.push(`Missing: ${listIds(missing)}.`);
  if (unexpected.length) parts.push(`Not expected: ${listIds(unexpected)}.`);
  if (repeated.size) parts.push(`Repeated: ${listIds([...repeated])}.`);
  throw new Error(parts.join(' '));
}
