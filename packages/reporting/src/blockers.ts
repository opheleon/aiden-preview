import type { Call, Product } from '../../contracts/src/index.js';

/** Open scope decisions pause work unless explicitly classified as reversible and non-blocking. */
export function isBlocking(call: Call): boolean {
  return call.kind === 'decision' && call.status === 'open' && call.blocking !== false;
}

/** Resolve direct, project-wide, and transitive feature blockers without trusting model readiness claims. */
export function requirementBlockers(product: Product, calls: Call[]): Map<string, Call[]> {
  const open = calls.filter(isBlocking);
  const ids = new Set(product.requirements.map((r) => r.id));
  const result = new Map(
    product.requirements.map((r) => [
      r.id,
      open.filter((c) => !c.requirementId || !ids.has(c.requirementId) || c.requirementId === r.id),
    ]),
  );
  const features = new Map<string, Call[]>();
  for (const feature of product.deliveryPlan ?? []) {
    const inherited = feature.dependsOn.flatMap((id) => features.get(id) ?? []);
    for (const id of feature.requirementIds)
      result.set(id, [...new Set([...(result.get(id) ?? []), ...inherited])]);
    features.set(feature.id, [
      ...new Set(feature.requirementIds.flatMap((id) => result.get(id) ?? [])),
    ]);
  }
  return result;
}

/** Human-readable reason that names the decision, owner, and work it unlocks. */
export function blockerReason(calls: Call[]): string {
  return calls.map((c) => `${c.question} Owner: ${c.owner}. ${c.assumption}`).join(' ');
}
