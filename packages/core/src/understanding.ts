import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod/v3';

import {
  assertUniqueRequirements,
  type Baseline,
  type CallDraft,
  CallDraftSchema,
  DeliveryPlanSchema,
  edgeCaseId,
  type Product,
  ProductSchema,
  requirementId,
} from '../../contracts/src/index.js';
import { allowedRequirementIds } from './baseline.js';

/**
 * What the understand stage returns: what done means, the edge cases that tend to break each
 * requirement, and the calls a person has to make. Every field is required so provider schema
 * validators accept it; an empty list means none.
 */
export const UnderstandingSchema = z
  .object({
    title: z.string().trim().min(1).max(72),
    overview: z.string().trim().min(1),
    requirements: z
      .array(
        z
          .object({
            id: requirementId,
            text: z.string().trim().min(1),
            edgeCases: z
              .array(z.object({ id: edgeCaseId, text: z.string().trim().min(1).max(300) }).strict())
              .max(6),
          })
          .strict(),
      )
      .min(1),
    milestones: z.array(z.string()),
    deliveryPlan: DeliveryPlanSchema,
    calls: z.array(CallDraftSchema.extend({ blocking: z.boolean() })).max(8),
    /**
     * Exact questions from the input's open calls that prior answers or changed intent now settle,
     * including reworded duplicates of an answered question. Empty when none are settled.
     */
    settledCalls: z.array(z.string().trim().min(1).max(400)).max(8),
    /** IDs of the repositories the intent is about; empty means all of them. */
    repositories: z.array(z.string()).max(100),
  })
  .strict();
/** Parsed understand-stage output. */
export type Understanding = z.infer<typeof UnderstandingSchema>;
/** Older checkpoints may lack a delivery plan or settled calls; only new output requires them. */
const StoredUnderstandingSchema = UnderstandingSchema.partial({
  deliveryPlan: true,
  title: true,
  settledCalls: true,
}).extend({
  calls: z.array(CallDraftSchema).max(8),
});
/** Validated checkpoint output, including the legacy shape without a delivery plan. */
export type StoredUnderstanding = z.infer<typeof StoredUnderstandingSchema>;

/**
 * Split validated understanding into the product that becomes the baseline, the calls Aiden
 * records, and the open questions it reports as settled. Edge cases proposed while scoping are
 * marked `scope`; empty lists are omitted.
 */
export function productFromUnderstanding(
  understanding: StoredUnderstanding,
  repositoryIds: string[] = [],
): {
  product: Product;
  calls: CallDraft[];
  settledCalls: string[];
} {
  const chosen = [...new Set(understanding.repositories ?? [])];
  // Choosing every repository is the same as choosing none: the look covers the whole project.
  const narrowed = chosen.length > 0 && chosen.length < repositoryIds.length;
  const product = ProductSchema.parse({
    ...(understanding.title ? { title: understanding.title } : {}),
    overview: understanding.overview,
    milestones: understanding.milestones,
    ...(understanding.deliveryPlan ? { deliveryPlan: understanding.deliveryPlan } : {}),
    ...(narrowed || (!repositoryIds.length && chosen.length) ? { repositories: chosen } : {}),
    requirements: understanding.requirements.map((r) => ({
      id: r.id,
      text: r.text,
      ...(r.edgeCases.length
        ? { edgeCases: r.edgeCases.map((e) => ({ ...e, origin: 'scope' as const })) }
        : {}),
    })),
  });
  return { product, calls: understanding.calls, settledCalls: understanding.settledCalls ?? [] };
}

/**
 * Validate model output against the contract, requirement continuity with the previous baseline,
 * and call references, so a bad ID is corrected by the model instead of failing the commit later.
 */
export function parseUnderstanding(
  value: unknown,
  previous: Baseline | null,
  repositoryIds: string[] = [],
  fromCheckpoint = false,
): StoredUnderstanding {
  const schema = fromCheckpoint ? StoredUnderstandingSchema : UnderstandingSchema;
  const understanding = schema.parse(withRepositories(value));
  if (!fromCheckpoint) requireFoundationTests(understanding);
  const unknown = understanding.repositories.find((id) => !repositoryIds.includes(id));
  if (unknown) throw new Error(`Repository ${unknown} is not in this project.`);
  const { product, calls } = productFromUnderstanding(understanding, repositoryIds);
  assertUniqueRequirements(product);
  allowedRequirementIds(product, previous);
  for (const call of calls) {
    if (call.edgeCaseId && !call.requirementId)
      throw new Error(`Call "${call.question}" names an edge case without its requirement.`);
    if (!call.requirementId) continue;
    const requirement = product.requirements.find((r) => r.id === call.requirementId);
    if (!requirement)
      throw new Error(`Call "${call.question}" names unknown requirement ${call.requirementId}.`);
    if (call.edgeCaseId && !requirement.edgeCases?.some((e) => e.id === call.edgeCaseId))
      throw new Error(
        `Call "${call.question}" names unknown edge case ${call.edgeCaseId} on ${call.requirementId}.`,
      );
  }
  return understanding;
}

/**
 * Read a saved understand checkpoint for review. Runs saved before edge cases and calls existed
 * stored a plain product, which is still returned as is.
 */
export function savedProduct(value: unknown): Product {
  const legacy = ProductSchema.safeParse(value);
  if (legacy.success) return legacy.data;
  return productFromUnderstanding(StoredUnderstandingSchema.parse(withRepositories(value))).product;
}

/** Checkpoints saved before repositories were chosen read as "every repository". */
function withRepositories(value: unknown): unknown {
  return value && typeof value === 'object' && !('repositories' in value)
    ? { ...value, repositories: [] }
    : value;
}

/** Largest README excerpt shown to the model when choosing repositories. */
const aboutLimit = 400;

/**
 * A short description of a repository for choosing which ones an intent is about: its folder
 * name, the person's notes, and the start of its README. The README is evidence, never
 * instructions; symlinks and unreadable files are skipped.
 */
export async function describeRepository(repo: {
  id: string;
  path: string;
  notes: string;
}): Promise<{ id: string; name: string; notes: string; readme: string }> {
  let readme = '';
  for (const file of ['README.md', 'readme.md', 'README']) {
    try {
      const location = path.join(repo.path, file);
      if (!(await lstat(location)).isFile()) continue;
      const handle = await open(location, 'r');
      try {
        const { bytesRead, buffer } = await handle.read(
          Buffer.alloc(aboutLimit * 4),
          0,
          aboutLimit * 4,
          0,
        );
        readme = buffer.subarray(0, bytesRead).toString('utf8').slice(0, aboutLimit);
      } finally {
        await handle.close();
      }
      break;
    } catch {
      // Try the next name; a repository without a README is described by its name alone.
    }
  }
  return { id: repo.id, name: path.basename(repo.path), notes: repo.notes, readme };
}

/** New foundations must specify verification; historic checkpoints remain readable. */
function requireFoundationTests(understanding: StoredUnderstanding): void {
  if (understanding.deliveryPlan?.some((f) => f.kind === 'platform' && !f.testPlan))
    throw new Error(
      'Shared platform work requires a testPlan with consumer integration, expected results, and failure checks.',
    );
}
