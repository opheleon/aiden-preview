import type { Call, Findings, Product } from '../../contracts/src/index.js';
import { blockerReason, requirementBlockers } from '../../reporting/src/blockers.js';
import { readCalls } from './calls.js';
import type { Store } from './storage.js';

/** Read the current persisted blockers, including decisions raised during an active run. */
export async function blockedRequirements(
  store: Store,
  projectId: string,
  product: Product,
): Promise<Map<string, Call[]>> {
  return requirementBlockers(product, await readCalls(store, projectId));
}

/** Suppress completion and executable work for blocked requirements, even if a model proposed it. */
export async function applyBlockers(
  store: Store,
  projectId: string,
  product: Product,
  findings: Findings,
): Promise<Findings> {
  const blocked = await blockedRequirements(store, projectId, product);
  return {
    ...findings,
    assessments: product.requirements.map((r) => {
      const calls = blocked.get(r.id) ?? [];
      if (!calls.length) return findings.assessments.find((a) => a.requirementId === r.id)!;
      const reason = `Blocked: ${blockerReason(calls)}`;
      return {
        requirementId: r.id,
        status: 'unknown',
        deviation: false,
        explanation: reason,
        evidence: [],
        remainingWork: [],
        unknowns: [reason],
      };
    }),
  };
}

/** Total project sizing waits for scope decisions rather than inventing effort for undefined behavior. */
export async function requireDefinedScope(
  store: Store,
  projectId: string,
  product: Product,
): Promise<void> {
  const blocked = await blockedRequirements(store, projectId, product);
  if ([...blocked.values()].some((calls) => calls.length))
    throw new Error(
      'Resolve blocking scope decisions before starting delivery or sizing the plan. Independent investigation and tickets can continue.',
    );
}
