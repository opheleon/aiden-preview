import type { DeliveryFeature, Product, Report } from '../../../../packages/contracts/src/index';
import type { ItemState } from './requirement-status';

/** One feature's progress, preserving the agreed implementation order. */
export interface FeatureProgress {
  feature: DeliveryFeature;
  done: number;
  total: number;
  complete: boolean;
  waitingOn: string[];
  blocked: boolean;
}

/** Count requirements against each feature and resolve hard dependencies without reordering it. */
export function featureProgress(
  product: Product,
  states: Map<string, ItemState>,
): FeatureProgress[] {
  const features = (product.deliveryPlan ?? []).map((feature) => {
    const done = feature.requirementIds.filter((id) => states.get(id)?.label === 'Done').length;
    return {
      feature,
      done,
      total: feature.requirementIds.length,
      complete: done === feature.requirementIds.length,
      waitingOn: [] as string[],
      blocked: feature.requirementIds.some((id) => states.get(id)?.label === 'Blocked'),
    };
  });
  return features.map((item) => ({
    ...item,
    waitingOn: item.feature.dependsOn
      .filter((id) => !features.find((f) => f.feature.id === id)?.complete)
      .map((id) => features.find((f) => f.feature.id === id)?.feature.title ?? id),
  }));
}

/** Explain code-assessment changes only for identical scope, not as verified delivery progress. */
export function progressChange(report: Report | undefined, previous: Report | null): string {
  if (!report || !previous || previous.id === report.id)
    return 'The next check will establish what changed.';
  if (report.baselineId !== previous.baselineId)
    return 'Scope changed since the previous check; progress uses the new scope.';
  const before = new Map(previous.assessments.map((a) => [a.requirementId, a.status]));
  const added = report.assessments.filter(
    (a) => a.status === 'implemented' && before.get(a.requirementId) !== 'implemented',
  ).length;
  const regressed = report.assessments.filter(
    (a) => a.status !== 'implemented' && before.get(a.requirementId) === 'implemented',
  ).length;
  return `${added} newly built, ${regressed} regressed in code since the previous check.`;
}

/** Whether moving a feature respects all hard prerequisites. */
export function orderedPlan(plan: DeliveryFeature[]): boolean {
  return plan.every((feature, index) =>
    feature.dependsOn.every((id) => plan.slice(0, index).some((f) => f.id === id)),
  );
}

/** Keep ownership valid when scope is edited; new requirements receive an explicit final feature. */
export function reconcilePlan(product: Product): Product {
  if (!product.deliveryPlan) return product;
  const ids = new Set(product.requirements.map((r) => r.id));
  const kept = product.deliveryPlan
    .map((f) => ({ ...f, requirementIds: f.requirementIds.filter((id) => ids.has(id)) }))
    .filter((f) => f.requirementIds.length);
  const retained = new Set(kept.map((f) => f.id));
  const plan = kept.map((f) => ({ ...f, dependsOn: f.dependsOn.filter((id) => retained.has(id)) }));
  const assigned = new Set(plan.flatMap((f) => f.requirementIds));
  const added = [...ids].filter((id) => !assigned.has(id));
  if (added.length)
    plan.push({
      id: `F-${Math.max(0, ...product.deliveryPlan.map((f) => Number(f.id.slice(2)))) + 1}`,
      title: 'Added scope',
      kind: 'feature',
      outcome: 'Deliver the newly added requirements.',
      rationale:
        'Added after the current plan. Adjust its position and dependencies in the plan editor.',
      requirementIds: added,
      dependsOn: [],
    });
  return { ...product, deliveryPlan: plan };
}
