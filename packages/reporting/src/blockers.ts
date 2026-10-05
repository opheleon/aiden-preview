import type { Call, Product } from '../../contracts/src/index.js';

/** Open scope decisions pause work unless explicitly classified as reversible and non-blocking. */
export function isBlocking(call: Call): boolean {
  return call.kind === 'decision' && call.status === 'open' && call.blocking !== false;
}

/**
 * Where a requirement's blockers come from. `direct` decisions leave the requirement's own behavior
 * undefined; `inherited` decisions belong to a hard prerequisite feature, so the requirement is
 * defined but its delivery waits.
 */
export interface BlockerSources {
  direct: Call[];
  inherited: Call[];
}

/**
 * Split open blockers into decisions on each requirement (including project-wide decisions and
 * decisions naming unknown requirements) and decisions inherited transitively through `dependsOn`.
 */
export function blockerSources(product: Product, calls: Call[]): Map<string, BlockerSources> {
  const open = calls.filter(isBlocking);
  const ids = new Set(product.requirements.map((r) => r.id));
  const direct = new Map(
    product.requirements.map((r) => [
      r.id,
      open.filter((c) => !c.requirementId || !ids.has(c.requirementId) || c.requirementId === r.id),
    ]),
  );
  const inherited = new Map<string, Call[]>();
  const features = new Map<string, Call[]>();
  for (const feature of product.deliveryPlan ?? []) {
    const upstream = [...new Set(feature.dependsOn.flatMap((id) => features.get(id) ?? []))];
    for (const id of feature.requirementIds)
      inherited.set(
        id,
        upstream.filter((c) => !direct.get(id)?.includes(c)),
      );
    features.set(feature.id, [
      ...new Set(
        feature.requirementIds.flatMap((id) => [
          ...(direct.get(id) ?? []),
          ...(inherited.get(id) ?? []),
        ]),
      ),
    ]);
  }
  return new Map(
    product.requirements.map((r) => [
      r.id,
      { direct: direct.get(r.id) ?? [], inherited: inherited.get(r.id) ?? [] },
    ]),
  );
}

/** Resolve direct, project-wide, and transitive feature blockers without trusting model readiness claims. */
export function requirementBlockers(product: Product, calls: Call[]): Map<string, Call[]> {
  return new Map(
    [...blockerSources(product, calls)].map(([id, sources]) => [
      id,
      [...sources.direct, ...sources.inherited],
    ]),
  );
}

/** Human-readable reason that names the decision, owner, and work it unlocks. */
export function blockerReason(calls: Call[]): string {
  return calls.map((c) => `${c.question} Owner: ${c.owner}. ${c.assumption}`).join(' ');
}

/**
 * Explain an inherited wait by naming the undecided prerequisite feature. The prerequisite's
 * assumption is omitted because it describes that feature's paused work, not this one's.
 * Example: "F-2 Redirect links needs a decision first: Should links expire? Owner: you."
 */
export function waitingReason(product: Product, calls: Call[]): string {
  return calls
    .map((c) => {
      const origin = product.deliveryPlan?.find(
        (f) => !!c.requirementId && f.requirementIds.includes(c.requirementId),
      );
      const subject = origin ? `${origin.id} ${origin.title}` : 'A prerequisite feature';
      return `${subject} needs a decision first: ${c.question} Owner: ${c.owner}.`;
    })
    .join(' ');
}
