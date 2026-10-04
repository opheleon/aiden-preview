import path from 'node:path';

import { type Call, type CallDraft, CallsSchema } from '../../contracts/src/index.js';
import { atomic, optionalJson, type Store, uid } from './storage.js';

/** Most calls kept per project; open calls are never pruned. */
const maxCalls = 500;

/** Serialize read-modify-write of each project's calls within this worker process. */
const queues = new Map<string, Promise<unknown>>();

/** Run one calls.json mutation after every earlier one for the same project has settled. */
function exclusive<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(projectId) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.catch(() => {});
  queues.set(projectId, settled);
  void settled.then(() => {
    if (queues.get(projectId) === settled) queues.delete(projectId);
  });
  return next;
}

/** Location of a project's calls. */
const callsFile = (store: Store, projectId: string): string =>
  path.join(store.project(projectId), 'calls.json');

/** Compare questions without case or spacing differences, so a re-asked call is not duplicated. */
const sameQuestion = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/** Read every recorded call for a project, oldest first; a new project has none. */
export async function readCalls(store: Store, projectId: string): Promise<Call[]> {
  return CallsSchema.parse((await optionalJson(callsFile(store, projectId))) ?? []);
}

/** Validate and persist calls, dropping the oldest settled calls beyond the cap. */
async function writeCalls(store: Store, projectId: string, calls: Call[]): Promise<void> {
  let kept = calls;
  while (kept.length > maxCalls) {
    const index = kept.findIndex((c) => c.status !== 'open');
    if (index < 0) break;
    kept = kept.filter((_, i) => i !== index);
  }
  await atomic(callsFile(store, projectId), CallsSchema.parse(kept));
}

/** Build a new open call from a draft. */
function newCall(draft: CallDraft, kind: Call['kind'], runId: string | null): Call {
  return {
    ...draft,
    id: uid(),
    kind,
    status: 'open',
    answer: null,
    askedAt: new Date().toISOString(),
    answeredAt: null,
    runId,
  };
}

/**
 * Record an open decision with its blocking classification. An open call asking the same question,
 * or an open app-url call, is returned instead of creating a duplicate.
 */
export function recordCall(
  store: Store,
  projectId: string,
  draft: CallDraft,
  kind: Call['kind'],
  runId: string | null,
): Promise<{ call: Call; created: boolean }> {
  return exclusive(projectId, async () => {
    const calls = await readCalls(store, projectId);
    const existing = calls.find(
      (c) =>
        c.status === 'open' &&
        c.kind === kind &&
        (kind === 'app-url' || sameQuestion(c.question, draft.question)),
    );
    if (existing) {
      if (kind === 'decision' && draft.blocking !== false && existing.blocking === false) {
        Object.assign(existing, draft, { blocking: true });
        await writeCalls(store, projectId, calls);
      }
      return { call: existing, created: false };
    }
    const call = newCall(draft, kind, runId);
    await writeCalls(store, projectId, [...calls, call]);
    return { call, created: true };
  });
}

/**
 * Replace open scope decisions after Aiden rewrites what done means. Calls re-proposed by the
 * new understanding keep their identity; calls raised during this run are kept; other open
 * non-blocking decisions may be dropped; unresolved blockers survive omission. Returns new calls.
 */
export function replaceOpenDecisions(
  store: Store,
  projectId: string,
  drafts: CallDraft[],
  runId: string,
): Promise<Call[]> {
  return exclusive(projectId, async () => {
    const calls = await readCalls(store, projectId);
    const created: Call[] = [];
    const kept = new Set<string>();
    for (const draft of drafts) {
      const existing = calls.find(
        (c) =>
          c.status === 'open' && c.kind === 'decision' && sameQuestion(c.question, draft.question),
      );
      if (existing) {
        const blocking = existing.blocking !== false || draft.blocking !== false;
        Object.assign(existing, draft, { blocking });
        kept.add(existing.id);
      } else created.push(newCall(draft, 'decision', runId));
    }
    const updated = calls.map((c) =>
      c.status === 'open' &&
      c.kind === 'decision' &&
      c.blocking === false &&
      c.runId !== runId &&
      !kept.has(c.id)
        ? { ...c, status: 'dropped' as const }
        : c,
    );
    await writeCalls(store, projectId, [...updated, ...created]);
    return created;
  });
}

/** Record a person's answer to an open call; answered and dropped calls cannot be answered again. */
export function answerCall(
  store: Store,
  projectId: string,
  callId: string,
  answer: string,
): Promise<Call> {
  const text = answer.trim();
  if (!text) return Promise.reject(new Error('An answer is required.'));
  return exclusive(projectId, async () => {
    const calls = await readCalls(store, projectId);
    const call = calls.find((c) => c.id === callId);
    if (!call || call.status !== 'open') throw new Error('This call is no longer open.');
    const answered: Call = {
      ...call,
      status: 'answered',
      answer: text,
      answeredAt: new Date().toISOString(),
    };
    await writeCalls(
      store,
      projectId,
      calls.map((c) => (c.id === callId ? answered : c)),
    );
    return answered;
  });
}

/** Close any open app-url call once Aiden knows where the app runs. */
export function settleAppUrlCalls(store: Store, projectId: string, url: string): Promise<void> {
  return exclusive(projectId, async () => {
    const calls = await readCalls(store, projectId);
    if (!calls.some((c) => c.kind === 'app-url' && c.status === 'open')) return;
    const now = new Date().toISOString();
    await writeCalls(
      store,
      projectId,
      calls.map((c) =>
        c.kind === 'app-url' && c.status === 'open'
          ? { ...c, status: 'answered' as const, answer: url, answeredAt: now }
          : c,
      ),
    );
  });
}

/** Decisions people have made, in the shape workflow prompts receive as prior answers. */
export async function answeredDecisions(
  store: Store,
  projectId: string,
): Promise<
  { question: string; answer: string; requirementId: string | null; edgeCaseId: string | null }[]
> {
  return (await readCalls(store, projectId))
    .filter((c) => c.kind === 'decision' && c.status === 'answered' && c.answer)
    .map((c) => ({
      question: c.question,
      answer: c.answer!,
      requirementId: c.requirementId,
      edgeCaseId: c.edgeCaseId,
    }));
}
