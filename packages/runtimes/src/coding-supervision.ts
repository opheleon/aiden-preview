import { ExecutionWatchdog } from './execution-watchdog.js';
import type { RuntimeRequest, RuntimeResult } from './types.js';

/** Bound coding even for solo launches; Teams may supply stricter server-selected budgets. */
export async function superviseCoding(
  request: RuntimeRequest,
  execute: (request: RuntimeRequest) => Promise<RuntimeResult>,
): Promise<RuntimeResult> {
  if (!request.coding) return execute(request);
  request.signal.throwIfAborted();
  const limits = request.coding.limits ?? {
    idleMs: 15 * 60_000,
    toolMs: 45 * 60_000,
    absoluteMs: 2 * 60 * 60_000,
  };
  const controller = new AbortController();
  const watch = new ExecutionWatchdog(limits, Date.now(), Number.POSITIVE_INFINITY);
  /** Forward user cancellation and stop the SDK without waiting for another provider event. */
  const stop = (): void => controller.abort(request.signal.reason);
  request.signal.addEventListener('abort', stop, { once: true });
  /** Remove this abort handler when the run finishes. */
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () =>
      reject(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error('Coding was interrupted.'),
      );
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  const timer = setInterval(() => {
    const reason = watch.reason(Date.now());
    if (reason) controller.abort(new Error(reason));
  }, 1000);
  timer.unref();
  try {
    return await Promise.race([
      execute({
        ...request,
        signal: controller.signal,
        activity: (activity) => {
          watch.observe(activity, Date.now());
          request.activity?.(activity);
        },
      }),
      aborted,
    ]);
  } finally {
    clearInterval(timer);
    request.signal.removeEventListener('abort', stop);
    controller.signal.removeEventListener('abort', rejectAbort);
    controller.abort();
  }
}
