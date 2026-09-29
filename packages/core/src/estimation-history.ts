import path from 'node:path';

import { z } from 'zod/v3';

import {
  type ExternalReadReceipt,
  ExternalReadReceiptSchema,
  ProjectSourcesSchema,
  type RunManifest,
} from '../../contracts/src/index.js';
import { publicError } from '../../runtimes/src/index.js';
import {
  externalPayload,
  nextCursor,
  normalizedHistory,
  paginationComplete,
  recordArray,
  type UnclassifiedHistory,
} from './history-normalization.js';
import { atomic, hash, optionalJson } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

const sourceSchema = z.object({
  selection: ProjectSourcesSchema.shape.history.unwrap(),
  records: z.array(z.unknown()),
  reads: z.array(
    z.object({
      arguments: z.record(z.unknown()),
      result: z.unknown(),
      receipt: ExternalReadReceiptSchema,
    }),
  ),
  historyComplete: z.boolean(),
  historyTruncated: z.boolean(),
});
type Source = z.infer<typeof sourceSchema>;
type Context = Pick<WorkflowContext, 'integrations' | 'emit' | 'getEstimate'>;
type EstimateRun = RunManifest & { refreshHistory?: boolean };

/** Normalized source evidence and explicit completeness limits used by estimation and forecasting. */
export interface EstimationHistory {
  rows: UnclassifiedHistory[];
  receipts: ExternalReadReceipt[];
  historyComplete: boolean;
  historyTruncated: boolean;
  historyCollectedAt: string | null;
  historyLimitations: string[];
}

/** Discover supported pagination parameters only on an explicitly approved history tool. */
async function historyParameters(
  context: Context,
  selection: Source['selection'],
): Promise<{
  limit: string | undefined;
  cursor: string | undefined;
  date: string | undefined;
}> {
  const definition = (await context.integrations.refreshTools(selection.connectionId)).find(
    (tool) => tool.name === selection.historyTool,
  );
  if (!definition?.approved) throw new Error('The selected history tool is not approved.');
  const value = definition.inputSchema.properties;
  const properties = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    limit: ['limit', 'first', 'pageSize', 'page_size'].find((key) => key in properties),
    cursor: ['cursor', 'after', 'pageToken', 'page_token'].find((key) => key in properties),
    date: ['completedAfter', 'completed_after', 'completedSince', 'completed_since'].find(
      (key) => key in properties,
    ),
  };
}

/** Read at most 500 records and 100 distinct pages; unadvanceable cursors cannot prove completeness. */
async function collectPages(
  context: Context,
  selection: Source['selection'],
  signal: AbortSignal,
  cutoff: string,
): Promise<Source> {
  const keys = await historyParameters(context, selection);
  const source: Source = {
    selection,
    records: [],
    reads: [],
    historyComplete: false,
    historyTruncated: false,
  };
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    signal.throwIfAborted();
    const requested = Math.min(100, 500 - source.records.length);
    const args: Record<string, unknown> = { [selection.sourceArgument]: selection.sourceId };
    if (keys.limit) args[keys.limit] = requested;
    if (keys.date) args[keys.date] = cutoff;
    if (cursor && keys.cursor) args[keys.cursor] = cursor;
    const read = await context.integrations.call(
      selection.connectionId,
      selection.historyTool,
      args,
      signal,
    );
    source.reads.push({ arguments: args, result: read.result, receipt: read.receipt });
    const payload = externalPayload(read.result);
    const page = recordArray(payload);
    source.records.push(...page);
    cursor = nextCursor(payload);
    if (source.records.length >= 500 || source.reads.length >= 100) {
      source.historyTruncated = !!cursor || source.records.length > 500;
      source.records = source.records.slice(0, 500);
      break;
    }
    if (!cursor) {
      source.historyComplete = paginationComplete(
        payload,
        page.length,
        keys.limit ? requested : null,
      );
      break;
    }
    if (!keys.cursor || seen.has(cursor)) {
      source.historyTruncated = true;
      break;
    }
    seen.add(cursor);
  } while (cursor);
  return source;
}

/** Resume a validated source checkpoint; explicit refresh failures preserve an already accepted estimate. */
async function sourceForRun(
  context: Context,
  run: EstimateRun,
  signal: AbortSignal,
  dir: string,
  cutoff: string,
  limitations: string[],
): Promise<Source | null> {
  const selection = run.project.sources?.history;
  if (!selection) {
    limitations.push('Connect a ticket source to estimate time from recent completed work.');
    return null;
  }
  const saved = await optionalJson<unknown>(path.join(dir, 'history-source.json'));
  if (saved !== null) {
    const source = sourceSchema.parse(saved);
    if (hash(source.selection) === hash(selection)) return source;
  }
  context.emit({
    type: 'progress',
    runId: run.id,
    projectId: run.projectId,
    stage: 'estimate',
    message: `Collecting the last 90 days from ${selection.sourceLabel}…`,
  });
  try {
    const source = await collectPages(context, selection, signal, cutoff);
    await atomic(path.join(dir, 'history-source.json'), { ...source, cutoff }, signal);
    return source;
  } catch (error) {
    signal.throwIfAborted();
    const previous = await context.getEstimate(run.projectId);
    if (run.refreshHistory && previous)
      throw new Error('History refresh failed. The previous accepted estimate was preserved.', {
        cause: error,
      });
    limitations.push(
      `History is unavailable: ${publicError(error)} Reconnect the ticket source and re-estimate to obtain time estimates.`,
    );
    return null;
  }
}

/** Verify receipt identities and normalize only completed records within the rolling history window. */
export async function collectEstimationHistory(
  context: Context,
  run: EstimateRun,
  signal: AbortSignal,
  dir: string,
): Promise<EstimationHistory> {
  const historyLimitations: string[] = [];
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const source = await sourceForRun(context, run, signal, dir, cutoff, historyLimitations);
  if (!source)
    return {
      rows: [],
      receipts: [],
      historyComplete: false,
      historyTruncated: false,
      historyCollectedAt: null,
      historyLimitations,
    };
  const normalized = normalizedHistory(
    source.records,
    source.selection.connectionId,
    source.selection.sourceId,
  );
  if (normalized.rows.some((row) => !row.completedAt))
    historyLimitations.push(
      'Records without a valid completion timestamp were excluded from the 90-day history window.',
    );
  for (const read of source.reads) {
    if (
      read.receipt.argumentsHash !== hash(read.arguments) ||
      read.receipt.resultHash !== hash(read.result)
    )
      throw new Error('A recorded external source read failed identity validation.');
  }
  if (source.historyTruncated)
    historyLimitations.push(
      'History collection reached a record/call safety limit or could not advance pagination safely.',
    );
  else if (!source.historyComplete)
    historyLimitations.push(
      'The server did not provide enough pagination information to verify complete history.',
    );
  historyLimitations.push(...normalized.limitations);
  return {
    rows: normalized.rows.filter(
      (row) =>
        !!row.completedAt &&
        row.completedAt >= cutoff &&
        row.completedAt <= new Date().toISOString(),
    ),
    receipts: source.reads.map((read) => read.receipt),
    historyComplete: source.historyComplete,
    historyTruncated: source.historyTruncated,
    historyCollectedAt: source.reads.at(-1)?.receipt.calledAt ?? null,
    historyLimitations,
  };
}
