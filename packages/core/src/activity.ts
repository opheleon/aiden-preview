import path from 'node:path';

import {
  type ActivityEntry,
  ActivityEntrySchema,
  type RunManifest,
} from '../../contracts/src/index.js';
import { plainText } from '../../verification/src/index.js';
import { runHistory } from './engine-queries.js';
import { appendLine, readLines, type Store } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

/** Most entries returned for one project's timeline. */
const timelineLimit = 300;

/** A count with its noun, singular for one: `counted(1, 'edge case')` is "1 edge case". */
export const counted = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Fields a workflow supplies; Aiden stamps the time and run. */
export type ActivityInput = Omit<ActivityEntry, 'at' | 'runId' | 'reconstructed'>;

/** Clip text to a schema limit without splitting the final character. */
function clip(text: string, limit: number): string {
  const flat = plainText(text).replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${[...flat].slice(0, limit - 3).join('')}...`;
}

/**
 * Append one line to the run's action log and stream it to the app. Text passes through `redact`
 * (test credentials) and em dash normalization, and is clipped to the contract limits.
 */
export async function appendActivity(
  context: Pick<WorkflowContext, 'store' | 'emit'>,
  run: Pick<RunManifest, 'id' | 'projectId'>,
  input: ActivityInput,
  redact: (text: string) => string = (text) => text,
): Promise<ActivityEntry> {
  const entry = ActivityEntrySchema.parse({
    ...input,
    at: new Date().toISOString(),
    runId: run.id,
    summary: clip(redact(input.summary), 300),
    ...(input.reason ? { reason: clip(redact(input.reason), 600) } : {}),
  });
  await appendLine(context.store.run(run.projectId, run.id), 'activity.jsonl', entry);
  context.emit({ type: 'activity', runId: run.id, projectId: run.projectId, activity: entry });
  return entry;
}

/** Most steps saved for one run; later steps still stream live but are not kept. */
const maxSteps = 2000;
/** Steps saved so far per run in this worker. */
const stepCounts = new Map<string, number>();

/**
 * Record one concrete action, such as reading a file or clicking a button, in the run's full
 * history and stream it live. Recording never fails the run: a step that cannot be saved is
 * dropped.
 */
export async function recordStep(
  context: Pick<WorkflowContext, 'store' | 'emit'>,
  run: Pick<RunManifest, 'id' | 'projectId'>,
  summary: string,
  redact?: (text: string) => string,
): Promise<void> {
  const count = (stepCounts.get(run.id) ?? 0) + 1;
  stepCounts.set(run.id, count);
  if (count > maxSteps) return;
  await appendActivity(context, run, { kind: 'step', summary }, redact).catch(() => {});
}

/** What each kind of run did, in the words the timeline uses for runs without a log. */
const reconstructedSummary: Record<RunManifest['kind'], string> = {
  prepare: 'Wrote the requirements from your goal.',
  report: 'Checked the code against the requirements.',
  estimate: 'Estimated the remaining work.',
  verify: 'Checked the running app.',
};

/** Rebuild a minimal log for runs recorded before the action log existed, labeled as such. */
function reconstruct(run: RunManifest): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    {
      at: run.createdAt,
      runId: run.id,
      kind: 'look',
      summary: reconstructedSummary[run.kind],
      reconstructed: true,
    },
  ];
  const outcome =
    run.status === 'completed'
      ? 'Finished.'
      : run.status === 'failed'
        ? `Stopped: ${clip(run.error ?? 'unknown error', 280)}`
        : run.status === 'cancelled'
          ? 'Cancelled.'
          : null;
  if (outcome)
    entries.push({
      at: run.createdAt,
      runId: run.id,
      kind: 'result',
      summary: outcome,
      reconstructed: true,
    });
  return entries;
}

/** Read one run's log, skipping lines that no longer match the contract. */
async function runActivity(store: Store, run: RunManifest): Promise<ActivityEntry[] | null> {
  const file = path.join(store.run(run.projectId, run.id), 'activity.jsonl');
  const lines = await readLines(file);
  if (!lines.length) return null;
  return lines.flatMap((line) => {
    const parsed = ActivityEntrySchema.safeParse(line);
    return parsed.success && parsed.data.runId === run.id ? [parsed.data] : [];
  });
}

/** One run's full history, oldest first, including every step; rebuilt for runs without a log. */
export async function readRunLog(
  store: Store,
  projectId: string,
  runId: string,
): Promise<ActivityEntry[]> {
  const run = (await runHistory(store, projectId)).find((r) => r.id === runId);
  if (!run) throw new Error('This run no longer exists.');
  return (await runActivity(store, run)) ?? reconstruct(run);
}

/**
 * What Aiden did on a project, newest first, for the brief: decisions and outcomes, without the
 * individual steps; runs recorded before the log existed get rebuilt entries.
 */
export async function readActivity(store: Store, projectId: string): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = [];
  for (const run of await runHistory(store, projectId)) {
    const lines = (await runActivity(store, run)) ?? reconstruct(run);
    entries.push(...lines.filter((e) => e.kind !== 'step'));
    if (entries.length >= timelineLimit) break;
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, timelineLimit);
}
