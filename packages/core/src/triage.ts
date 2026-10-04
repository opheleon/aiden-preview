import type { Product, TriageItem } from '../../contracts/src/index.js';
import { counted } from './activity.js';

/** Most browser checks in one look; main paths are kept before edge cases. */
export const maxAppChecks = 30;

/** One thing Aiden checks: a requirement's main path, or one of its edge cases. */
export type CheckItem = {
  /** Folder and evidence key: `REQ-n` for the main path, `REQ-n-En` for an edge case. */
  key: string;
  requirementId: string;
  edgeCaseId: string | null;
  /** What has to hold for this item to pass. */
  text: string;
  /** The requirement this item belongs to, for context when checking an edge case. */
  requirement: string;
};

/** A check Aiden will run in the browser, with who to act as. */
export type AppCheck = CheckItem & { persona: string | null; method?: 'app' | 'api' };

/** Evidence key for a requirement or one of its edge cases. */
export const itemKey = (requirementId: string, edgeCaseId: string | null): string =>
  edgeCaseId ? `${requirementId}-${edgeCaseId}` : requirementId;

/** List every requirement's main path followed by its edge cases, in baseline order. */
export function checkItems(product: Product): CheckItem[] {
  return product.requirements.flatMap((r) => [
    { key: r.id, requirementId: r.id, edgeCaseId: null, text: r.text, requirement: r.text },
    ...(r.edgeCases ?? []).map((e) => ({
      key: itemKey(r.id, e.id),
      requirementId: r.id,
      edgeCaseId: e.id,
      text: e.text,
      requirement: r.text,
    })),
  ]);
}

/**
 * Give every item exactly one plan entry. Entries for unknown items are dropped, the first entry
 * wins for duplicates, and items the plan missed are checked in the app, which is what a person
 * would try first. A null plan (the model gave no usable answer) sends everything to the app.
 */
export function reconcilePlan(items: CheckItem[], plan: TriageItem[] | null): TriageItem[] {
  const byKey = new Map<string, TriageItem>();
  for (const entry of plan ?? []) {
    const key = itemKey(entry.requirementId, entry.edgeCaseId);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return items.map(
    (item) =>
      byKey.get(item.key) ?? {
        requirementId: item.requirementId,
        edgeCaseId: item.edgeCaseId,
        method: 'app',
        persona: null,
        reason: plan
          ? 'Not in the plan, so Aiden checks it in the app.'
          : 'Aiden could not plan this look, so it checks everything in the app.',
      },
  );
}

/** Pick the browser checks from a plan, main paths first, capped at `maxAppChecks`. */
export function appChecks(
  items: CheckItem[],
  plan: TriageItem[],
): { checks: AppCheck[]; deferred: number } {
  const methods = new Map(plan.map((p) => [itemKey(p.requirementId, p.edgeCaseId), p]));
  const app = items.flatMap((item) => {
    const entry = methods.get(item.key);
    return entry?.method === 'app' || entry?.method === 'api'
      ? [{ ...item, persona: entry.persona, method: entry.method }]
      : [];
  });
  const ordered = [...app.filter((c) => !c.edgeCaseId), ...app.filter((c) => c.edgeCaseId)];
  return {
    checks: ordered.slice(0, maxAppChecks),
    deferred: Math.max(0, ordered.length - maxAppChecks),
  };
}

/** One sentence describing a plan for the action log. */
export function planSummary(plan: TriageItem[]): string {
  /** Number of plan entries using one method. */
  const count = (method: TriageItem['method']) => plan.filter((p) => p.method === method).length;
  return `Planned ${counted(plan.length, 'check')}: ${count('app')} in the app, ${count('api') ? `${count('api')} via API, ` : ''}${count('code')} in the code, ${count('person')} that need a person.`;
}
