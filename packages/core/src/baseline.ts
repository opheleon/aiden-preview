import path from 'node:path';

import {
  assertUniqueRequirements,
  type Baseline,
  type Product,
  ProductSchema,
} from '../../contracts/src/index.js';
import { answeredDecisions } from './calls.js';
import { atomic, hash, optionalJson, type Store, uid } from './storage.js';

/** Numeric part of a `REQ-n` identifier. */
const requirementNumber = (id: string): number => Number(id.slice(4));

/**
 * Reject requirement IDs that would break continuity with the previous baseline and return the
 * retired set the new baseline must carry. Retired IDs and unused IDs at or below the historical
 * maximum are rejected so a reused ID never inherits another requirement's history.
 */
export function allowedRequirementIds(product: Product, previous: Baseline | null): string[] {
  const activeIds = new Set(previous?.product.requirements.map((r) => r.id) ?? []);
  const retired = new Set(previous?.retiredIds ?? []);
  const max = Math.max(0, ...[...activeIds, ...retired].map(requirementNumber));
  for (const req of product.requirements) {
    if (retired.has(req.id) || (!activeIds.has(req.id) && requirementNumber(req.id) <= max))
      throw new Error(
        'Retired requirement IDs cannot be reused. Allocate new IDs above the historical maximum.',
      );
  }
  for (const old of activeIds)
    if (!product.requirements.some((r) => r.id === old)) retired.add(old);
  return [...retired];
}

/** Commit a product as the project's new immutable baseline. The caller holds the project lock. */
export async function commitBaseline(
  store: Store,
  projectId: string,
  productInput: unknown,
  context: string,
  decisionsHash?: string,
): Promise<Baseline> {
  const product = ProductSchema.parse(productInput);
  assertUniqueRequirements(product);
  const folder = store.project(projectId);
  const previous = await optionalJson<Baseline>(path.join(folder, 'baseline.json'));
  const baseline: Baseline = {
    id: uid(),
    projectId,
    contextHash: hash(context),
    decisionsHash: decisionsHash ?? hash(await answeredDecisions(store, projectId)),
    product,
    retiredIds: allowedRequirementIds(product, previous),
    reviewedAt: new Date().toISOString(),
  };
  await atomic(path.join(folder, 'baselines', `${baseline.id}.json`), baseline);
  await atomic(path.join(folder, 'baseline.json'), baseline);
  return baseline;
}
