import type { Call, Findings, Product } from '../../contracts/src/index.js';
import {
  blockerReason,
  type BlockerSources,
  blockerSources,
  requirementBlockers,
  waitingReason,
} from '../../reporting/src/blockers.js';
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

/**
 * Read persisted blockers split by origin. Code assessment excludes only requirements with their
 * own open decisions; requirements waiting on a prerequisite's decision are defined and assessable.
 */
export async function blockerOrigins(
  store: Store,
  projectId: string,
  product: Product,
): Promise<Map<string, BlockerSources>> {
  return blockerSources(product, await readCalls(store, projectId));
}

/** Assessment for a requirement that cannot be judged in this check, with the reason as an unknown. */
function unassessed(requirementId: string, reason: string): Findings['assessments'][number] {
  return {
    requirementId,
    status: 'unknown',
    deviation: false,
    explanation: reason,
    evidence: [],
    remainingWork: [],
    unknowns: [reason],
  };
}

/**
 * Suppress completion and executable work for undefined requirements, even if a model proposed it.
 * Requirements that only wait on a prerequisite's decision keep their code evidence and status but
 * lose executable steps, because delivery still waits for the prerequisite. A requirement missing
 * from the findings, such as one unblocked after the check started, is reported as not assessed.
 */
export async function applyBlockers(
  store: Store,
  projectId: string,
  product: Product,
  findings: Findings,
): Promise<Findings> {
  const origins = await blockerOrigins(store, projectId, product);
  return {
    ...findings,
    assessments: product.requirements.map((r) => {
      const { direct, inherited } = origins.get(r.id) ?? { direct: [], inherited: [] };
      if (direct.length) return unassessed(r.id, `Blocked: ${blockerReason(direct)}`);
      const assessed = findings.assessments.find((a) => a.requirementId === r.id);
      if (!inherited.length)
        return (
          assessed ?? unassessed(r.id, 'Not assessed in this check. The next check covers it.')
        );
      const reason = `Waiting: ${waitingReason(product, inherited)}`;
      if (!assessed) return unassessed(r.id, reason);
      return { ...assessed, remainingWork: [], unknowns: [...assessed.unknowns, reason] };
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
