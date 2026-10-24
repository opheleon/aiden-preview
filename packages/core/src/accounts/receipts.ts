import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { NewAccountTask } from '../../../contracts/src/accounts-api.js';
import { atomic, json, type Store } from '../storage.js';
import { type AccountsClient, AccountsError } from './client.js';

/** A durable completion receipt survives process restarts and lost HTTP acknowledgements. */
export interface CompletionReceipt {
  taskId: string;
  projectId: string;
  deviceId: string;
  attemptId: string;
  result: unknown;
  followUps: NewAccountTask[];
  outcome: { durationSec: number; usageBefore: null; usageAfter: null; costUsd: null };
  documentChanged: boolean;
  status: 'pending' | 'acknowledged' | 'superseded';
}

/** File names are hashes of server identifiers, never paths supplied by a remote caller. */
function receiptFile(store: Store, receipt: CompletionReceipt): string {
  const key = createHash('sha256').update(`${receipt.taskId}:${receipt.attemptId}`).digest('hex');
  return path.join(store.root, 'team-completions', `${key}.json`);
}

/** Save before sending completion; provider credentials and raw output are never included. */
export function saveReceipt(store: Store, receipt: CompletionReceipt): Promise<void> {
  return atomic(receiptFile(store, receipt), receipt);
}

/** Retry acknowledgement without executing a model or marking completed work as failed. */
export async function sendReceipt(
  store: Store,
  client: AccountsClient,
  receipt: CompletionReceipt,
  upload: (projectId: string) => Promise<void>,
): Promise<void> {
  const { taskId, deviceId, attemptId, result, followUps, outcome } = receipt;
  try {
    if (receipt.documentChanged) {
      await client.authorize(taskId, { deviceId, attemptId });
      await upload(receipt.projectId);
      receipt.documentChanged = false;
      await saveReceipt(store, receipt);
    }
    await client.complete(taskId, { deviceId, attemptId, result, followUps, outcome });
    receipt.status = 'acknowledged';
  } catch (error) {
    if (error instanceof AccountsError && [404, 409].includes(error.status))
      receipt.status = 'superseded';
    else throw error;
  }
  await saveReceipt(store, receipt);
}

/** Replay only this device's pending receipts before asking for new work. Keep all evidence on disk. */
export async function flushReceipts(
  store: Store,
  client: AccountsClient,
  deviceId: string,
  upload: (projectId: string) => Promise<void>,
): Promise<void> {
  const folder = path.join(store.root, 'team-completions');
  const files = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const file of files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
    const receipt = await json<CompletionReceipt>(path.join(folder, file));
    if (receipt.status === 'pending' && receipt.deviceId === deviceId)
      await sendReceipt(store, client, receipt, upload);
  }
}
