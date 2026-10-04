import type { Baseline, Call, RunManifest } from '../../../../packages/contracts/src/index';
import { isBlocking, requirementBlockers } from '../../../../packages/reporting/src/blockers';

/** Outstanding decisions relevant to this run, with dependency-aware scope coverage. */
export interface RunBlockage {
  calls: Call[];
  all: boolean;
}

/** Relate saved decisions to their originating run or a later check of the same current scope. */
export function runBlockage(
  run: RunManifest,
  calls: Call[],
  baseline?: Baseline,
): RunBlockage | null {
  if (run.status === 'failed' || run.status === 'cancelled') return null;
  const relevant = calls.filter(
    (call) =>
      isBlocking(call) &&
      (call.runId === run.id ||
        (run.kind !== 'prepare' &&
          run.kind !== 'verify' &&
          !!run.baseline &&
          run.baseline.id === baseline?.id &&
          call.askedAt <= run.createdAt)),
  );
  if (!relevant.length) return null;
  const product = run.baseline?.product ?? (run.kind === 'prepare' ? baseline?.product : undefined);
  const blocked = product ? [...requirementBlockers(product, relevant).values()] : [];
  return {
    calls: relevant,
    all: run.kind === 'estimate' || !blocked.length || blocked.every((items) => items.length > 0),
  };
}
