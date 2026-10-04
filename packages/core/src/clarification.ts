import type { RunManifest } from '../../contracts/src/index.js';
import type { ClarificationRequest } from '../../tools/src/broker.js';
import { appendActivity } from './activity.js';
import { recordCall } from './calls.js';
import type { WorkflowContext } from './workflow-context.js';

/**
 * Record a decision and pause affected work for blockers. An answer starts a new look;
 * independent investigation can continue while a person decides.
 */
export async function requestClarification(
  context: Pick<WorkflowContext, 'store' | 'emit'>,
  run: Pick<RunManifest, 'id' | 'projectId'>,
  signal: AbortSignal,
  request: ClarificationRequest,
): Promise<string> {
  signal.throwIfAborted();
  const { call, created } = await recordCall(
    context.store,
    run.projectId,
    {
      question: request.question,
      blocking: request.blocking ?? true,
      assumption: request.assumption,
      options: request.options ?? [],
      requirementId: request.requirementId ?? null,
      edgeCaseId: request.requirementId ? (request.edgeCaseId ?? null) : null,
      owner: 'you',
    },
    'decision',
    run.id,
  );
  if (created)
    await appendActivity(context, run, {
      kind: 'ask',
      ...(call.requirementId ? { requirementId: call.requirementId } : {}),
      ...(call.edgeCaseId ? { edgeCaseId: call.edgeCaseId } : {}),
      summary: `Asked you: ${call.question}`,
      reason:
        call.blocking === false
          ? `Reversible assumption: ${call.assumption}`
          : `Blocked: ${call.question}. ${call.assumption}`,
    });
  return call.blocking === false
    ? `Recorded a non-blocking decision. Proceed on the reversible assumption: ${call.assumption}`
    : `Blocked: ${call.question}. Pause this requirement and its dependent work until answered. Do not invent behavior or prepare implementation instructions for it. Continue only independent work. ${call.assumption}`;
}
