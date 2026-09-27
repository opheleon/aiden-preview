import { z } from 'zod/v3';

import { publicError } from '../../runtimes/src/index.js';

const envelope = z
  .object({
    protocol: z.literal('1.0'),
    id: z.union([z.number().int(), z.string()]),
    method: z.string(),
    params: z.unknown().optional(),
  })
  .strict();
/** The transport reply preserves request identity but never exposes non-Error thrown objects. */
export type WorkerReply = {
  id: string | number | null;
  result?: unknown;
  error?: { message: string };
};

/** Validate one bounded JSON-lines request and invoke only an own, allowlisted method. */
export async function dispatchWorkerLine(
  line: string,
  methods: Record<string, (params: unknown) => unknown>,
): Promise<WorkerReply> {
  let requestId: string | number | null = null;
  try {
    if (line.length > 2_000_000) throw new Error('Request is too large.');
    const request = envelope.parse(JSON.parse(line));
    requestId = request.id;
    const method = Object.hasOwn(methods, request.method) ? methods[request.method] : undefined;
    if (!method) throw new Error('Unknown operation.');
    const result: unknown = await method(request.params ?? {});
    return { id: requestId, result: result ?? null };
  } catch (error) {
    return { id: requestId, error: { message: publicError(error) } };
  }
}
