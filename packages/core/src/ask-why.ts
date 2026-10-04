import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod/v3';

import {
  type ActivityEntry,
  ActivityEntrySchema,
  type ChatMessage,
  ChatSchema,
  outputSchemaFor,
  type RunManifest,
} from '../../contracts/src/index.js';
import { ArtifactFormatError } from '../../runtimes/src/index.js';
import { noTools, serveTools } from '../../tools/src/mcp.js';
import { plainText } from '../../verification/src/index.js';
import { workflowRoot } from './model-stage.js';
import { atomic, json, optionalJson, readLines, type Store } from './storage.js';
import { readVerification } from './verification-workflow.js';
import type { WorkflowContext } from './workflow-context.js';

/** What answering needs: saved runs, the project's own runtime and billing, and saved reports. */
type AskContext = Pick<WorkflowContext, 'store' | 'runtime' | 'getReport'>;

/** Longest Aiden spends on one answer, inside the worker's two-minute request limit. */
const answerTimeoutMs = 100_000;
/** Log lines and earlier messages included in one question, newest kept. */
const maxLogLines = 200;
const maxEarlier = 12;

const AnswerSchema = z.object({ answer: z.string().trim().min(1).max(1500) }).strict();

/** Serialize chat writes per run within this worker. */
const queues = new Map<string, Promise<unknown>>();

/** Run one chat mutation after earlier ones for the same run have settled. */
function exclusive<T>(runId: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(runId) ?? Promise.resolve()).then(task, task);
  const settled = next.catch(() => {});
  queues.set(runId, settled);
  void settled.then(() => {
    if (queues.get(runId) === settled) queues.delete(runId);
  });
  return next;
}

/** Location of a run's conversation. */
const chatFile = (store: Store, projectId: string, runId: string): string =>
  path.join(store.run(projectId, runId), 'chat.json');

/** A run's "Why?" conversation, oldest first; a run nobody asked about has none. */
export async function readChat(
  store: Store,
  projectId: string,
  runId: string,
): Promise<ChatMessage[]> {
  return ChatSchema.parse((await optionalJson(chatFile(store, projectId, runId))) ?? []);
}

/** Append messages, keeping the newest when the conversation reaches its cap. */
async function append(
  store: Store,
  projectId: string,
  runId: string,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const chat = [...(await readChat(store, projectId, runId)), ...messages].slice(-200);
  await atomic(chatFile(store, projectId, runId), ChatSchema.parse(chat));
  return chat;
}

/** Build a message with Aiden's text normalized: no em dashes, bounded length. */
function message(from: ChatMessage['from'], text: string, source?: ChatMessage['source']) {
  const clean = plainText(text).trim();
  return {
    at: new Date().toISOString(),
    from,
    text: clean.length > 2000 ? `${clean.slice(0, 1997)}...` : clean,
    ...(source ? { source } : {}),
  };
}

/** The run's saved action log, skipping lines that no longer match the contract. */
async function runLog(store: Store, run: RunManifest): Promise<ActivityEntry[]> {
  const lines = await readLines(path.join(store.run(run.projectId, run.id), 'activity.jsonl'));
  return lines.flatMap((line) => {
    const parsed = ActivityEntrySchema.safeParse(line);
    return parsed.success && parsed.data.runId === run.id ? [parsed.data] : [];
  });
}

/** What the run concluded, from its saved report or browser check, when it finished. */
async function outcome(context: AskContext, run: RunManifest): Promise<unknown> {
  if (run.status !== 'completed') return null;
  if (run.kind === 'report') {
    const report = await context.getReport(run.projectId, run.id).catch(() => null);
    return (
      report && {
        summary: report.summary,
        findings: report.assessments.map((a) => ({
          requirementId: a.requirementId,
          status: a.status,
          explanation: a.explanation,
          evidence: a.evidence.map(
            (e) => `${e.repositoryId} ${e.path}:${e.startLine}-${e.endLine}`,
          ),
          remainingWork: a.remainingWork,
        })),
      }
    );
  }
  if (run.kind !== 'verify') return null;
  const saved = await readVerification(context, run.projectId, run.id);
  return (
    saved && {
      plan: saved.result.triage ?? null,
      checks: saved.result.criteria.map((c) => {
        const decisive = c.attempts.find((a) => a.attempt === c.decisiveAttempt);
        return {
          requirementId: c.requirementId,
          edgeCaseId: c.edgeCaseId ?? null,
          persona: c.persona ?? null,
          verdict: c.verdict,
          reason: c.reason,
          explanation: c.explanation,
          expected: c.expected,
          observed: c.observed,
          steps: (decisive?.steps ?? [])
            .slice(0, 25)
            .map((s) => ({ atMs: s.atMs, action: s.action, result: s.result })),
        };
      }),
    }
  );
}

/** Ask the project's model to answer from the run's saved record only; it gets no tools. */
async function modelAnswer(
  context: AskContext,
  run: RunManifest,
  question: string,
  earlier: ChatMessage[],
): Promise<string> {
  const log = await runLog(context.store, run);
  const input = {
    question,
    run: {
      kind: run.kind,
      startedBecause: run.reason ?? null,
      status: run.status,
      error: run.error ?? null,
      startedAt: run.createdAt,
    },
    log: log.slice(-maxLogLines),
    outcome: await outcome(context, run),
    earlier: earlier.slice(-maxEarlier).map((m) => ({ from: m.from, text: m.text })),
  };
  const instructions = await readFile(path.join(workflowRoot, 'workflows/v1/ask-why.md'), 'utf8');
  const schema = outputSchemaFor(AnswerSchema);
  const cwd = path.join(context.store.run(run.projectId, run.id), 'runtime');
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const tools = await serveTools(noTools);
  try {
    const result = await context.runtime.run({
      config: run.project.runtime,
      prompt: `${instructions}\n<input_data>\n${JSON.stringify(input)}\n</input_data>\nReturn ONLY the JSON object matching this schema:\n${JSON.stringify(schema)}`,
      schema,
      cwd,
      tools,
      signal: AbortSignal.timeout(answerTimeoutMs),
      progress: () => {},
    });
    const parsed = AnswerSchema.safeParse(result.value);
    if (parsed.success) return parsed.data.answer;
  } catch (error) {
    if (!(error instanceof ArtifactFormatError)) throw error;
  } finally {
    await tools.close();
  }
  throw new Error("Aiden could not answer from this run's record. Try asking another way.");
}

/** Load a run's manifest, confirming it belongs to the project. */
async function savedRun(store: Store, projectId: string, runId: string): Promise<RunManifest> {
  const run = await json<RunManifest>(path.join(store.run(projectId, runId), 'manifest.json'));
  if (run.id !== runId || run.projectId !== projectId) throw new Error('Run identity mismatch.');
  return run;
}

/**
 * Answer a question about one run from what Aiden recorded while doing it, using the project's
 * selected runtime and billing. The question and answer are saved to the run's conversation.
 */
export function askWhy(
  context: AskContext,
  projectId: string,
  runId: string,
  question: string,
): Promise<ChatMessage[]> {
  const text = question.trim();
  if (!text) return Promise.reject(new Error('Ask a question about this run.'));
  return exclusive(runId, async () => {
    const run = await savedRun(context.store, projectId, runId);
    const earlier = await readChat(context.store, projectId, runId);
    const answer = await modelAnswer(context, run, text, earlier);
    return append(context.store, projectId, runId, [
      message('you', text),
      message('aiden', answer, 'model'),
    ]);
  });
}

/**
 * Explain one line of the action log. A line with a reason recorded when Aiden acted is answered
 * from that reason straight away, at no cost; any other line is asked of the model.
 */
export async function explainEntry(
  context: AskContext,
  projectId: string,
  runId: string,
  entry: { at: string; summary: string },
): Promise<ChatMessage[]> {
  const run = await savedRun(context.store, projectId, runId);
  const logged = (await runLog(context.store, run)).find(
    (e) => e.at === entry.at && e.summary === entry.summary,
  );
  const question = `Why: ${entry.summary}`;
  if (!logged?.reason) return askWhy(context, projectId, runId, question);
  const reason = logged.reason;
  return exclusive(runId, () =>
    append(context.store, projectId, runId, [
      message('you', question),
      message('aiden', reason, 'log'),
    ]),
  );
}
