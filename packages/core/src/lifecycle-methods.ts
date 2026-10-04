import { z } from 'zod/v3';

import type { WorkerMethod } from '../../contracts/src/api.js';
import { id } from '../../contracts/src/index.js';
import type { Engine } from './engine.js';
import { decideProject, requireOpenProject } from './project-lifecycle.js';

const project = z.object({ projectId: id }).strict();
const note = z.string().trim().min(1).max(2000);
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
      const p = project.extend({ note }).parse(input);
      return decideProject(engine, p.projectId, { action: 'closed', note: p.note });
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

/** Block stale UI writes on closed projects and reject decisions while a worker mutation is in flight. */
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
      if (deciding.has(projectId) || (decisions.has(method) && pending.get(projectId)))
        throw new Error(
          'A project operation is still finishing. Wait for it to finish, then try again.',
        );
      if (decisions.has(method)) deciding.add(projectId);
      pending.set(projectId, (pending.get(projectId) ?? 0) + 1);
      return (async () => {
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
