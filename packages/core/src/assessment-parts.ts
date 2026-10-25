import { type Findings, FindingsSchema, type Product } from '../../contracts/src/index.js';
import type { ModelStage } from './model-stage.js';

/** Most requirements one assessment call checks, so each one gets a close reading of the code. */
export const requirementsPerPart = 8;
/** Most parts checked at the same time, to finish sooner without flooding the provider. */
const partsAtOnce = 3;

/**
 * Group requirement IDs for assessment in delivery-plan order, keeping each feature's
 * requirements together when they fit in one part. Requirements no feature lists come last.
 * Example: features of 3, 6 and 2 requirements give parts of 3 and 8 requirements.
 * @param requirementIds The requirements to assess, in baseline order.
 * @param plan The baseline delivery plan, when there is one.
 * @param size The most requirements in one part.
 */
export function assessmentParts(
  requirementIds: string[],
  plan: Product['deliveryPlan'],
  size = requirementsPerPart,
): string[][] {
  const wanted = new Set(requirementIds);
  const groups = (plan ?? []).map((feature) =>
    feature.requirementIds.filter((id) => wanted.has(id)),
  );
  const planned = new Set(groups.flat());
  groups.push(requirementIds.filter((id) => !planned.has(id)));
  const parts: string[][] = [];
  let current: string[] = [];
  for (const group of groups) {
    if (current.length && current.length + group.length > size) {
      parts.push(current);
      current = [];
    }
    for (const id of group) {
      if (current.length === size) {
        parts.push(current);
        current = [];
      }
      current.push(id);
    }
  }
  if (current.length) parts.push(current);
  return parts;
}

/**
 * Assess a large baseline in focused parts with the same assess prompt, up to three at a time,
 * and merge the findings. Each part sees the other requirements as context only. A baseline that fits one part keeps the
 * single `assess` call and checkpoint it always had.
 * @param stage The run's model stage.
 * @param product The eligible requirements to assess.
 * @param plan The baseline delivery plan used to group requirements.
 * @param input Everything else the assess prompt receives.
 * @param validate Checks one part's findings against exactly that part's requirements.
 */
export async function assessInParts(
  stage: ModelStage,
  product: Product,
  plan: Product['deliveryPlan'],
  input: Record<string, unknown>,
  validate: (value: unknown, part: Product) => Findings,
): Promise<Findings> {
  const parts = assessmentParts(
    product.requirements.map((r) => r.id),
    plan,
  );
  if (parts.length <= 1)
    return stage('assess', FindingsSchema, { ...input, baseline: product }, (v) =>
      validate(v, product),
    );
  /** Assess one part, with the rest of the requirements as context. */
  const assessPart = (index: number) => {
    const ids = parts[index]!;
    const part = {
      ...product,
      requirements: product.requirements.filter((r) => ids.includes(r.id)),
    };
    const otherRequirements = product.requirements
      .filter((r) => !ids.includes(r.id))
      .map(({ id, text }) => ({ id, text }));
    return stage(
      'assess',
      FindingsSchema,
      {
        ...input,
        baseline: part,
        part: { number: index + 1, of: parts.length },
        otherRequirements,
      },
      (v) => validate(v, part),
      String(index + 1),
    );
  };
  const results: Findings[] = [];
  let next = 0;
  /** Take the next unassessed part until none are left. */
  const worker = async () => {
    while (next < parts.length) {
      const index = next++;
      results[index] = await assessPart(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(partsAtOnce, parts.length) }, worker));
  const order = product.requirements.map((r) => r.id);
  /** One copy of each note the parts reported, in the order first seen. */
  const unique = (lists: string[][]) => [...new Set(lists.flat())];
  return {
    assessments: results
      .flatMap((r) => r.assessments)
      .sort((a, b) => order.indexOf(a.requirementId) - order.indexOf(b.requirementId)),
    risks: unique(results.map((r) => r.risks)),
    dependencies: unique(results.map((r) => r.dependencies)),
    unknowns: unique(results.map((r) => r.unknowns)),
  };
}

/** Checks a model's submitted artifact against one stage's schema; throws on a mismatch. */
export type ArtifactValidator = (value: unknown) => unknown;

/**
 * Track the artifact validators of stages whose parts run at the same time, so a submitted
 * candidate passes when it fits any running part of its stage. A stage without parts, or a
 * stage seen for the first time, starts a fresh set.
 * Example: parts 1 and 2 of assess both run; part 2's answer passes part 2's validator.
 * @returns Register a stage's validator and get the combined check for that stage.
 */
export function partValidators(): (
  stage: string,
  validate: ArtifactValidator,
  part?: string,
) => ArtifactValidator {
  const byStage = new Map<string, Map<string, ArtifactValidator>>();
  return (stage, validate, part) => {
    if (!part || !byStage.has(stage)) byStage.set(stage, new Map());
    const running = byStage.get(stage)!;
    running.set(part ?? '', validate);
    return (value) => anyValid([...running.values()], value);
  };
}

/**
 * Accept a candidate that one of the validators accepts, or report the first problem.
 * @param validators The running parts' validators, in the order they started.
 * @param value The submitted candidate.
 */
function anyValid(validators: ArtifactValidator[], value: unknown): unknown {
  let first: unknown;
  for (const check of validators) {
    try {
      return check(value);
    } catch (error) {
      first ??= error;
    }
  }
  throw first;
}
