import { appendFileSync } from 'node:fs';

/**
 * Opt-in trace of the Teams tier on this machine, for debugging a team flow end to end. Set
 * `AIDEN_TEAMS_DEBUG_LOG` to a file path and every Teams API call and agent step is appended as
 * one JSON line. Only ids, kinds, statuses, timings, and plain reasons are written: never tokens,
 * headers, documents, or task results.
 * Example line: {"at":"...","event":"api","method":"POST","route":"/work/next","status":200,"ms":41,"summary":{"decision":"assign"}}
 */
export function teamsDebug(event: string, fields: Record<string, unknown> = {}): void {
  const file = process.env.AIDEN_TEAMS_DEBUG_LOG;
  if (!file) return;
  try {
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + '\n');
  } catch {
    // Debug tracing never breaks the app.
  }
}

/** The fields worth tracing from one task, as the server returned it. */
function taskSummary(task: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ['id', 'kind', 'actor', 'status', 'attempts', 'leasedDeviceId', 'waiting'])
    if (task[key] !== undefined && task[key] !== null) picked[key] = task[key];
  return picked;
}

/**
 * A short, secret-free summary of a Teams API response body for the trace.
 * @param body The parsed JSON response.
 */
export function responseSummary(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  const decision = value.decision as { type?: unknown; reason?: unknown } | undefined;
  if (decision) summary.decision = { type: decision.type, reason: decision.reason };
  if (value.task && typeof value.task === 'object')
    summary.task = taskSummary(value.task as Record<string, unknown>);
  if (Array.isArray(value.tasks))
    summary.tasks = (value.tasks as Record<string, unknown>[]).map(taskSummary);
  if (typeof value.revision === 'number') summary.revision = value.revision;
  if (typeof value.status === 'string') Object.assign(summary, taskSummary(value));
  if (typeof value.error === 'string') summary.error = value.error;
  return Object.keys(summary).length ? summary : undefined;
}
