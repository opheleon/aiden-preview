import path from 'node:path';

import { z } from 'zod/v3';

import { atomic, optionalJson, type Store } from './storage.js';

/**
 * Manual tests a person marked done, by action item key, with the report they were done against.
 * A confirmation holds only for that report: once a later look sees new code, the test is due
 * again.
 */
export const ConfirmationsSchema = z.record(
  z.string().regex(/^REQ-[1-9]\d*(-E[1-9]\d*)?$/),
  z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
);
/** Saved confirmations: action item key to report ID. */
export type Confirmations = z.infer<typeof ConfirmationsSchema>;

/** Serialize writes per project within this worker. */
const queues = new Map<string, Promise<unknown>>();

/** Run one write after earlier ones for the same project have settled. */
function exclusive<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(projectId) ?? Promise.resolve()).then(task, task);
  const settled = next.catch(() => {});
  queues.set(projectId, settled);
  void settled.then(() => {
    if (queues.get(projectId) === settled) queues.delete(projectId);
  });
  return next;
}

/** Location of a project's confirmations. */
const file = (store: Store, projectId: string): string =>
  path.join(store.project(projectId), 'confirmed.json');

/** Every manual test marked done for the project; none for a new project. */
export async function readConfirmations(store: Store, projectId: string): Promise<Confirmations> {
  return ConfirmationsSchema.parse((await optionalJson(file(store, projectId))) ?? {});
}

/** Record that a person did a manual test against the given report. */
export function confirmAction(
  store: Store,
  projectId: string,
  key: string,
  reportId: string,
): Promise<Confirmations> {
  return exclusive(projectId, async () => {
    const next = ConfirmationsSchema.parse({
      ...(await readConfirmations(store, projectId)),
      [key]: reportId,
    });
    await atomic(file(store, projectId), next);
    return next;
  });
}
