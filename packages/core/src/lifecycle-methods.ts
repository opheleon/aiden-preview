import { z } from 'zod/v3';

import type { WorkerMethod } from '../../contracts/src/api.js';
import { id } from '../../contracts/src/index.js';
import type { Engine } from './engine.js';
import { decideProject, requireOpenProject } from './project-lifecycle.js';

const project = z.object({ projectId: id }).strict();
const note = z.string().trim().min(1).max(2000);
/** Closing needs no explanation; an empty note is saved as none. */
const closingNote = z.string().trim().max(2000).default('');
/** Validate project decisions at the trusted worker boundary. */
export function lifecycleMethods(
  engine: Engine,
): Pick<
  Record<WorkerMethod, (params: unknown) => unknown>,
  'acceptOutcome' | 'closeProject' | 'reopenProject'
> {
  return {
    acceptOutcome: (input: unknown) => {
      const p = project
        .extend({ note, evidenceKey: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(input);
      return decideProject(engine, p.projectId, {
        action: 'accepted',
        note: p.note,
        evidenceKey: p.evidenceKey,
      });
    },
    closeProject: (input: unknown) => {
      const p = project
        .extend({ note: closingNote, forgetCredentials: z.boolean().optional() })
        .parse(input);
      return decideProject(engine, p.projectId, {
        action: 'closed',
        note: p.note,
        ...(p.forgetCredentials !== undefined ? { forgetCredentials: p.forgetCredentials } : {}),
      });
    },
    reopenProject: (input: unknown) => {
      const p = project.parse(input);
      return decideProject(engine, p.projectId, {
        action: 'reopened',
        note: 'Monitoring resumed.',
      });
    },
  };
}

const decisions = new Set<WorkerMethod>(['acceptOutcome', 'closeProject', 'reopenProject']);
const writes = new Set<WorkerMethod>([
  'prepare',
  'approve',
  'report',
  'resume',
  'look',
  'startCoding',
  'updateBetaSettings',
  'updateSources',
  'estimate',
  'estimateOverrides',
  'verify',
  'updateVerificationSettings',
  'updateMonitoredBranch',
  'answerCall',
  'editIntent',
  'askGuide',
  'guideEvent',
  'configureGuideVerification',
  'connectCode',
  'confirmRequirements',
  'skipSetupStep',
  'confirmAction',
  'explain',
  'askWhy',
  'updateRuntime',
  'publishLinearTickets',
  'saveTicketSettings',
]);
const reconciles = new Set<WorkerMethod>([
  'reconcileDelivery',
  'syncTickets',
  'monitoring',
  'heads',
]);

const stillFinishing =
  'A project operation is still finishing. Wait for it to finish, then try again.';
/** How long a decision waits for other operations on the project to finish. */
const settleTimeoutMs = 20_000;

/** Wait until no operation is in flight for the project, or fail after the settle timeout. */
async function settled(pending: Map<string, number>, projectId: string): Promise<void> {
  const deadline = Date.now() + settleTimeoutMs;
  while (pending.get(projectId)) {
    if (Date.now() > deadline) throw new Error(stillFinishing);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Block stale UI writes on closed projects. A decision first waits for operations already in
 * flight, then holds off new writes until it is saved.
 */
export function guardLifecycleMethods(
  engine: Engine,
  methods: Record<WorkerMethod, (params: unknown) => unknown>,
): typeof methods {
  const pending = new Map<string, number>();
  const deciding = new Set<string>();
  for (const method of Object.keys(methods) as WorkerMethod[]) {
    if (!writes.has(method) && !reconciles.has(method) && !decisions.has(method)) continue;
    const call = methods[method];
    methods[method] = (input) => {
      // Keep boundary validation synchronous before asynchronous lifecycle admission.
      (call as typeof call & { validate?: (params: unknown) => void }).validate?.(input);
      const p = z
        .object({ projectId: id.optional(), project: z.object({ id }).optional() })
        .parse(input);
      const projectId = p.projectId ?? p.project?.id;
      if (!projectId) return call(input);
      if (deciding.has(projectId)) throw new Error(stillFinishing);
      if (decisions.has(method)) deciding.add(projectId);
      return (async () => {
        // A decision waits briefly for routine reads and writes, such as the checks that start
        // when a project opens, instead of failing because one happened to be in flight.
        if (decisions.has(method)) {
          try {
            await settled(pending, projectId);
          } catch (error) {
            deciding.delete(projectId);
            throw error;
          }
        }
        pending.set(projectId, (pending.get(projectId) ?? 0) + 1);
        try {
          if (writes.has(method)) await requireOpenProject(engine.store, projectId);
          return await call(input);
        } finally {
          pending.set(projectId, pending.get(projectId)! - 1);
          if (decisions.has(method)) deciding.delete(projectId);
        }
      })();
    };
  }
  return methods;
}
