import path from 'node:path';

import { z } from 'zod/v3';

import { atomic, optionalJson } from '../../../packages/core/src/storage.js';

const recordSchema = z
  .object({
    at: z.string().datetime(),
    component: z.enum(['startup', 'worker', 'renderer']),
    code: z.enum(['startup_failed', 'worker_stopped', 'renderer_crashed', 'renderer_unresponsive']),
  })
  .strict();
/** Diagnostic inputs deliberately cannot contain messages, payloads, or private paths. */
export type DiagnosticEvent = Omit<z.infer<typeof recordSchema>, 'at'>;

/** Keep the newest 100 allowlisted local events without uploading diagnostics. */
export class LocalDiagnostics {
  private readonly file: string;
  private writes = Promise.resolve();
  /** Store diagnostics alongside existing private Aiden data without reading project contents. */
  constructor(dataRoot: string) {
    this.file = path.join(dataRoot, 'diagnostics', 'events.json');
  }
  /** Record a coarse event with bounded retention; diagnostics failures never block application recovery. */
  record(event: DiagnosticEvent): Promise<void> {
    const operation = this.writes.then(async () => {
      const next = recordSchema.parse({ ...event, at: new Date().toISOString() });
      const previous: unknown = await optionalJson(this.file).catch(() => null);
      const records = Array.isArray(previous)
        ? previous.flatMap((value) => {
            const parsed = recordSchema.safeParse(value);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
      await atomic(this.file, [...records.slice(-99), next]);
    });
    this.writes = operation.catch(() => {
      /* Local diagnostics are best effort and never contain raw failures. */
    });
    return this.writes;
  }
}
