import type { AccountTask } from '../../../contracts/src/accounts-api.js';
import type { DeliveryCheckpoint } from '../../../contracts/src/accounts-execution.js';
import { ExecutionWatchdog } from '../../../runtimes/src/execution-watchdog.js';
import type { LocalToolServer } from '../../../tools/src/mcp.js';
import { type AccountsClient, AccountsError } from './client.js';
import type { TaskControls } from './runner.js';
import { statusTools } from './status-tools.js';

/** All dependencies needed to supervise one attempt without involving the renderer. */
export interface SupervisionInput {
  task: AccountTask;
  deviceId: string;
  deviceName: string;
  client: AccountsClient;
  controller: AbortController;
  sample: () => Promise<unknown>;
  interrupt: () => Promise<void>;
  progress: (line: string) => void;
  clock: () => Date;
}

/** Trusted runner controls and deterministic cleanup for one attempt. */
export interface SupervisedAttempt {
  controls: TaskControls;
  close: () => Promise<void>;
}

/** Create an authenticated status gateway and independently enforce lease, idle, and runtime limits. */
export async function superviseAttempt(input: SupervisionInput): Promise<SupervisedAttempt> {
  const { task, client, deviceId, controller, clock } = input;
  if (!task.execution || !task.leaseExpiresAt || task.execution.location !== 'local')
    throw new Error('This task has no valid local execution authority. Update Aiden Teams.');
  const binding = { deviceId, attemptId: task.execution.attemptId };
  const watch = new ExecutionWatchdog(
    task.execution.limits,
    new Date(task.execution.startedAt).getTime(),
    new Date(task.leaseExpiresAt).getTime(),
  );
  let tools: LocalToolServer | undefined;
  let beating = false;
  const messages: string[] = [];
  /** Stop both the coding process and any Aiden engine operations without dropping their files. */
  const stop = (reason: string): void => {
    if (controller.signal.aborted) return;
    controller.abort(new Error(reason));
    void input.interrupt().catch(() => {});
  };
  /** Validate local authority immediately before every external mutation. */
  const authorize = async (): Promise<void> => {
    controller.signal.throwIfAborted();
    const reason = watch.reason(clock().getTime());
    if (reason) {
      stop(reason);
      controller.signal.throwIfAborted();
    }
    await client.authorize(task.id, binding);
    controller.signal.throwIfAborted();
  };
  const guard = setInterval(() => {
    const reason = watch.reason(clock().getTime());
    if (reason) stop(reason);
  }, 1000);
  guard.unref();
  /** Heartbeats are serialized; slow network calls cannot pile up or revive a stopped attempt. */
  const heartbeat = async (): Promise<void> => {
    if (beating || controller.signal.aborted) return;
    beating = true;
    try {
      const saved = await client.heartbeat(task.id, {
        ...binding,
        deviceName: input.deviceName,
        sample: await input.sample(),
        messages: messages.splice(0).slice(-20),
        activitySequence: watch.activitySequence(),
      });
      if (saved.execution?.attemptId !== binding.attemptId || saved.status !== 'leased')
        return stop('The server ended this task attempt.');
      if (saved.leaseExpiresAt) watch.renew(new Date(saved.leaseExpiresAt).getTime());
    } catch (error) {
      if (error instanceof AccountsError && [401, 403, 404, 409].includes(error.status))
        stop('This task attempt is no longer authorized.');
    } finally {
      beating = false;
    }
  };
  const beat = setInterval(() => {
    void heartbeat();
  }, 15_000);
  beat.unref();
  /** Release the gateway and timers even when authorization or provider startup fails. */
  const close = async (): Promise<void> => {
    clearInterval(beat);
    clearInterval(guard);
    await tools?.close();
  };
  try {
    await authorize();
    tools = await statusTools(client, task, deviceId, () =>
      stop('The task is blocked on a human answer.'),
    );
    return {
      close,
      controls: {
        signal: controller.signal,
        limits: task.execution.limits,
        tools,
        authorize,
        checkpoint: async (checkpoint: DeliveryCheckpoint) => {
          await authorize();
          await client.checkpoint(task.id, { ...binding, checkpoint });
        },
        block: async (title, question) => {
          await client.needsHuman(task.id, { ...binding, title, question });
          stop(`The task is waiting on a person: ${title}.`);
        },
        activity: (activity) => watch.observe(activity, clock().getTime()),
        progress: (line) => {
          messages.push(line.slice(0, 500));
          if (messages.length > 20) messages.shift();
          input.progress(line);
        },
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
