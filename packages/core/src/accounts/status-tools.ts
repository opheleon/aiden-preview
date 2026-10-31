import type { AccountTask } from '../../../contracts/src/accounts-api.js';
import { AgentStatusSchema } from '../../../contracts/src/accounts-execution.js';
import { type LocalToolServer, serveTools } from '../../../tools/src/mcp.js';
import { defineTool } from '../../../tools/src/tool-definition.js';
import type { AccountsClient } from './client.js';

/** A task-scoped loopback gateway keeps rotating OAuth tokens outside the coding agent. */
export async function statusTools(
  client: AccountsClient,
  task: AccountTask,
  deviceId: string,
  blocked: () => void,
): Promise<LocalToolServer> {
  const attemptId = task.execution?.attemptId;
  if (!attemptId) throw new Error('Update Aiden Teams before starting unattended work.');
  await client.authorize(task.id, { deviceId, attemptId });
  let sequence = task.execution?.reportSequence ?? 0;
  let pending: { key: string; sequence: number } | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const tool = defineTool({
    name: 'report_status',
    description:
      'Report meaningful progress, an unresolved question, a genuine blocker, or an outcome claim. Use question to continue independent work; use blocked only when no authorized work can continue. message is a short status line; question is one direct question a person can answer, ending with a question mark and naming the choices, such as "Should F-2 wait for the F-1 pull request to merge, or include F-1 itself?". Aiden validates completion separately.',
    schema: AgentStatusSchema,
    readOnly: false,
    run: async (report) => {
      const key = JSON.stringify(report);
      if (!pending || pending.key !== key) pending = { key, sequence: ++sequence };
      const result = await client.reportStatus(task.id, {
        ...report,
        deviceId,
        attemptId,
        sequence: pending.sequence,
      });
      pending = undefined;
      if (report.state === 'blocked') {
        // Return the accepted question before shutting down the agent's stream.
        const timer = setTimeout(blocked, 100);
        timer.unref();
      }
      return { accepted: true, status: result.status, questionTaskId: result.blockedBy };
    },
  });
  return serveTools({
    definitions: () => [tool],
    call: (name, input) => {
      if (name !== tool.name) throw new Error('Unknown status tool.');
      const result = tail.then(() => tool.run(input));
      tail = result.catch(() => undefined);
      return result;
    },
  });
}
