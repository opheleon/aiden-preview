import { z } from 'zod/v3';

import { requirementId } from './ids.js';

/** Stable identity for a feature in the implementation plan. */
const featureId = z.string().regex(/^F-[1-9]\d*$/);

/** A usable vertical feature, or explicitly justified shared platform work. Array order is delivery order. */
export const DeliveryFeatureSchema = z
  .object({
    id: featureId,
    title: z.string().trim().min(1).max(120),
    outcome: z.string().trim().min(1).max(600),
    kind: z.enum(['feature', 'platform']),
    rationale: z.string().trim().min(1).max(600),
    testPlan: z.string().trim().min(1).max(1600).optional(),
    requirementIds: z.array(requirementId).min(1),
    dependsOn: z.array(featureId),
  })
  .strict();

/** Ordered work with complete requirement ownership and explicit hard prerequisites. */
export const DeliveryPlanSchema = z.array(DeliveryFeatureSchema).min(1).max(100);
/** One independently useful outcome and the requirements needed to deliver it. */
export type DeliveryFeature = z.infer<typeof DeliveryFeatureSchema>;

/**
 * Validate references and topological order. A dependency must precede its consumer, which
 * rejects self references and cycles as well as invalid moves. Every requirement belongs once.
 */
export function validateDeliveryPlan(
  plan: DeliveryFeature[],
  requirements: { id: string }[],
  context: z.RefinementCtx,
): void {
  const known = new Set(requirements.map((r) => r.id));
  const assigned = new Set<string>();
  const preceding = new Set<string>();
  /** Attach a readable failure to the delivery-plan field. */
  const issue = (message: string) =>
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deliveryPlan'], message });
  for (const feature of plan) {
    if (preceding.has(feature.id)) issue(`Duplicate feature ${feature.id}.`);
    if (new Set(feature.dependsOn).size !== feature.dependsOn.length)
      issue(`Duplicate dependencies for ${feature.id}.`);
    for (const dependency of feature.dependsOn)
      if (dependency === feature.id || !preceding.has(dependency))
        issue(`${feature.id} depends on ${dependency}, which must appear earlier in the plan.`);
    for (const requirement of feature.requirementIds) {
      if (!known.has(requirement)) issue(`Unknown requirement ${requirement} in ${feature.id}.`);
      if (assigned.has(requirement))
        issue(`Requirement ${requirement} belongs to more than one feature.`);
      assigned.add(requirement);
    }
    preceding.add(feature.id);
  }
  for (const requirement of known)
    if (!assigned.has(requirement))
      issue(`Requirement ${requirement} is missing from the delivery plan.`);
}
