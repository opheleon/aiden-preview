import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod/v3';

import {
  distinctGuideWidgets,
  type GuideAction,
  GuideActionSchema,
  type GuideMessage,
  GuideNextStepsSchema,
  type GuideThread,
  GuideThreadSchema,
  type GuideView,
  type GuideWidget,
  GuideWidgetSchema,
  maxGuideMessages,
  SetupStepIdSchema,
  VerifyMethodSchema,
} from '../../contracts/src/guide.js';
import { outputSchemaFor } from '../../contracts/src/index.js';
import { ArtifactFormatError } from '../../runtimes/src/index.js';
import { noTools, serveTools, type ToolProvider } from '../../tools/src/mcp.js';
import { plainText } from '../../verification/src/index.js';
import type { Engine } from './engine.js';
import { applyGuideActions } from './guide-actions.js';
import {
  type GuideFacts,
  guideFacts,
  guideInput,
  readSetupState,
  writeSetupState,
} from './guide-context.js';
import { checkAnnouncement } from './guide-results.js';
import {
  answerGuideClarification,
  guideClarifications,
  rewriteGuideRequirements,
} from './guide-scope.js';
import { guideTools } from './guide-tools.js';
import { workflowRoot } from './model-stage.js';
import { atomic, optionalJson, type Store } from './storage.js';

/** Longest one Guide turn takes, inside the worker's two-minute request limit. */
const turnTimeoutMs = 100_000;
/** Compaction starts past either bound and keeps the newest messages verbatim. */
const compactAfterMessages = 80;
const compactAfterCharacters = 40_000;
const keepVerbatim = 30;
/** Messages the model sees verbatim on each turn, newest kept. */
const promptMessages = 30;

/**
 * What the model returns. Fields are flat and nullable so every provider's structured output can
 * produce them; each widget and action is then validated against its strict contract.
 */
const ReplySchema = z
  .object({
    reply: z.string().trim().min(1).max(3000),
    nextSteps: GuideNextStepsSchema,
    widgets: z
      .array(
        z
          .object({
            type: z.enum([
              'confirm-requirements',
              'connect-code',
              'verify-options',
              'choose-folder',
              'web-check',
              'api-check',
              'phone-check',
              'manual-check',
              'run-check',
              'link',
            ]),
            recommended: VerifyMethodSchema.nullable(),
            url: z.string().nullable(),
            link: z.enum(['slack', 'help']).nullable(),
          })
          .strict(),
      )
      .max(4),
    actions: z
      .array(
        z
          .object({
            type: z.enum([
              'confirm-requirements',
              'answer-clarification',
              'save-web-check',
              'save-api-check',
              'set-manual',
              'update-intent',
              'run-check',
              're-estimate',
              'connect-repositories',
              'skip-step',
            ]),
            url: z.string().nullable(),
            allowMutations: z.boolean().nullable(),
            manual: z.boolean().nullable(),
            context: z.string().nullable(),
            callId: z.string().nullable().optional(),
            step: SetupStepIdSchema.nullable(),
            owner: z.string().nullable().optional(),
            repositories: z.array(z.string()).nullable().optional(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();
type Reply = z.infer<typeof ReplySchema>;

const SummarySchema = z.object({ summary: z.string().trim().min(1).max(6000) }).strict();

/** Serialize Guide writes per project within this worker. */
const queues = new Map<string, Promise<unknown>>();

/** Run one Guide mutation after earlier ones for the same project have settled. */
function exclusive<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(projectId) ?? Promise.resolve()).then(task, task);
  const settled = next.catch(() => {});
  queues.set(projectId, settled);
  void settled.then(() => {
    if (queues.get(projectId) === settled) queues.delete(projectId);
  });
  return next;
}

/** Location of a project's Guide conversation. */
const threadFile = (store: Store, projectId: string): string =>
  path.join(store.project(projectId), 'guide.json');

/** A project's Guide thread, oldest first; a project nobody talked to has an empty one. */
export async function readThread(store: Store, projectId: string): Promise<GuideThread> {
  return GuideThreadSchema.parse(
    (await optionalJson(threadFile(store, projectId))) ?? { messages: [] },
  );
}

/** Save the thread, dropping the oldest messages if compaction could not keep it under its cap. */
async function writeThread(store: Store, projectId: string, thread: GuideThread): Promise<void> {
  const messages = thread.messages.slice(-maxGuideMessages);
  await atomic(threadFile(store, projectId), GuideThreadSchema.parse({ ...thread, messages }));
}

/** Build a message with normalized text and steps: no em dashes, bounded length. */
export function guideMessage(
  from: GuideMessage['from'],
  text: string,
  widgets: GuideWidget[] = [],
  nextSteps: string[] = [],
): GuideMessage {
  const clean = plainText(text).trim() || '(empty)';
  const steps = nextSteps.map((step) => plainText(step).trim()).filter(Boolean);
  return {
    at: new Date().toISOString(),
    from,
    text: clean.length > 4000 ? `${clean.slice(0, 3997)}...` : clean,
    ...(widgets.length ? { widgets } : {}),
    ...(steps.length ? { nextSteps: steps } : {}),
  };
}

/** Drop null fields so a flat model reply can match a strict optional-field contract. */
function strip(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null));
}

/** Keep only widgets and actions that match their strict contracts; drop the rest. */
function validated(reply: Reply): { widgets: GuideWidget[]; actions: GuideAction[] } {
  const widgets = reply.widgets.flatMap((w) => {
    const parsed = GuideWidgetSchema.safeParse(strip(w));
    return parsed.success ? [parsed.data] : [];
  });
  const actions = reply.actions.flatMap((a) => {
    const parsed = GuideActionSchema.safeParse(strip(a));
    return parsed.success ? [parsed.data] : [];
  });
  return {
    widgets: distinctGuideWidgets(widgets),
    actions,
  };
}

/** Run one structured model call in the project's runtime folder, with only the given tools. */
async function modelCall<T>(
  engine: Engine,
  facts: GuideFacts,
  promptFile: string,
  input: unknown,
  schema: z.ZodType<T>,
  provider: ToolProvider = noTools,
): Promise<T | null> {
  const instructions = await readFile(path.join(workflowRoot, 'workflows/v1', promptFile), 'utf8');
  const jsonSchema = outputSchemaFor(schema);
  const cwd = path.join(engine.store.project(facts.project.id), 'guide-runtime');
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const tools = await serveTools(provider);
  try {
    const result = await engine.runtime.run({
      // The project's own provider and billing mode; the Guide never switches either.
      config: facts.project.runtime,
      prompt: `${instructions}\n<input_data>\n${JSON.stringify(input)}\n</input_data>\nReturn ONLY the JSON object matching this schema:\n${JSON.stringify(jsonSchema)}`,
      schema: jsonSchema,
      cwd,
      tools,
      signal: AbortSignal.timeout(turnTimeoutMs),
      progress: () => {},
    });
    const parsed = schema.safeParse(result.value);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof ArtifactFormatError) return null;
    throw error;
  } finally {
    await tools.close();
  }
}

/**
 * Condense older messages into the thread summary once the thread grows past its bounds. When the
 * summary call fails, the thread is kept as is and the cap trims the oldest messages instead.
 */
async function compact(
  engine: Engine,
  facts: GuideFacts,
  thread: GuideThread,
): Promise<GuideThread> {
  const characters = thread.messages.reduce((total, m) => total + m.text.length, 0);
  if (thread.messages.length <= compactAfterMessages && characters <= compactAfterCharacters)
    return thread;
  const older = thread.messages.slice(0, -keepVerbatim);
  const result = await modelCall(
    engine,
    facts,
    'guide-summary.md',
    {
      earlierSummary: thread.summary ?? null,
      messages: older.map((m) => ({ from: m.from, text: m.text })),
    },
    SummarySchema,
  ).catch(() => null);
  if (!result) return thread;
  return { summary: result.summary, messages: thread.messages.slice(-keepVerbatim) };
}

/** The current thread and checklist, read fresh after every change. */
export async function guideView(engine: Engine, projectId: string): Promise<GuideView> {
  const [thread, facts] = await Promise.all([
    readThread(engine.store, projectId),
    guideFacts(engine, projectId),
  ]);
  return {
    thread,
    setup: facts.setup,
    clarifications: await guideClarifications(engine, projectId),
    requirementsPending: !!facts.facts.requirementsPending,
  };
}

/** What starts a Guide turn: a kickoff playback, a retry of the last message, or new text. */
export type GuideTurn = {
  kickoff?: boolean;
  retry?: boolean;
  text?: string;
  /** An answer submitted from the current question card, without model interpretation. */
  clarification?: { callId: string; answer: string };
};

/** The person's newest message, when the Guide has not answered it yet. */
function unanswered(thread: GuideThread): GuideMessage | undefined {
  const last = thread.messages.filter((m) => m.from !== 'event').at(-1);
  return last?.from === 'you' ? last : undefined;
}

/** Save a question and the person's explicit reply in the conversational history. */
async function answerQuestion(
  engine: Engine,
  projectId: string,
  thread: GuideThread,
  clarification: NonNullable<GuideTurn['clarification']>,
): Promise<GuideView> {
  const { callId, answer } = clarification;
  const question = (await guideClarifications(engine, projectId)).find(
    (call) => call.id === callId,
  );
  const reply = await answerGuideClarification(engine, projectId, callId, answer);
  await writeThread(engine.store, projectId, {
    ...thread,
    messages: [
      ...thread.messages,
      ...(question ? [guideMessage('aiden', question.question)] : []),
      guideMessage('you', answer),
      guideMessage('aiden', reply),
    ],
  });
  return guideView(engine, projectId);
}

/** Retry persisted answers rather than asking the person to repeat a successfully saved decision. */
async function retryRequirements(
  engine: Engine,
  projectId: string,
  turn: GuideTurn,
  facts: GuideFacts,
): Promise<boolean> {
  if (!turn.retry || !facts.facts.requirementsPending || facts.facts.clarificationCount)
    return false;
  await rewriteGuideRequirements(engine, projectId);
  return true;
}

/** Hide model-proposed setup controls until the latest scope is ready for review. */
function scopeWidgets(facts: GuideFacts, widgets: GuideWidget[]): GuideWidget[] {
  return facts.facts.clarificationCount || facts.facts.requirementsPending
    ? widgets.filter((widget) => widget.type === 'link')
    : widgets;
}

/** Resolve a new message or retry to the person's actual words, never a model-written answer. */
function turnQuestion(turn: GuideTurn, thread: GuideThread): string | null {
  return turn.text?.trim() ?? (turn.retry ? unanswered(thread)?.text : undefined) ?? null;
}

/**
 * Take one Guide turn with the project's runtime and billing. The person's message is saved before
 * the model runs, so an interrupted turn can be asked again; setup changes the Guide makes are
 * applied afterwards and recorded as event lines.
 * Example: "Use https://staging.example.com" saves a web check and adds an event line.
 */
export function askGuide(engine: Engine, projectId: string, turn: GuideTurn): Promise<GuideView> {
  return exclusive(projectId, async () => {
    let thread = await readThread(engine.store, projectId);
    if (turn.clarification) return answerQuestion(engine, projectId, thread, turn.clarification);
    const text = turn.text?.trim();
    if (!turn.kickoff && !turn.retry && !text) throw new Error('Type a question for the Guide.');
    if (turn.kickoff && thread.messages.some((m) => m.from === 'aiden'))
      return guideView(engine, projectId);
    if (text) {
      thread = { ...thread, messages: [...thread.messages, guideMessage('you', text)] };
      await writeThread(engine.store, projectId, thread);
    }
    const facts = await guideFacts(engine, projectId);
    if (await retryRequirements(engine, projectId, turn, facts))
      return guideView(engine, projectId);
    const question = turnQuestion(turn, thread);
    const reply = await modelCall(
      engine,
      facts,
      'guide.md',
      {
        turn: turn.kickoff ? 'kickoff' : 'message',
        message: question,
        earlierSummary: thread.summary ?? null,
        conversation: thread.messages
          .slice(-promptMessages)
          .map((m) => ({ from: m.from, text: m.text, at: m.at })),
        ...(await guideInput(engine, facts)),
      },
      ReplySchema,
      guideTools(),
    );
    if (!reply) throw new Error('The Guide could not answer that. Try asking another way.');
    const { widgets, actions } = validated(reply);
    const events = await applyGuideActions(engine, projectId, actions, question ?? undefined);
    const fresh = await guideFacts(engine, projectId);
    const visibleWidgets = scopeWidgets(fresh, widgets);
    const saved = await readThread(engine.store, projectId);
    thread = {
      ...saved,
      messages: [
        ...saved.messages,
        guideMessage('aiden', reply.reply, visibleWidgets, reply.nextSteps),
        ...events.map((event) => guideMessage('event', event)),
      ],
    };
    await writeThread(engine.store, projectId, await compact(engine, facts, thread));
    return guideView(engine, projectId);
  });
}

/**
 * Open the Guide: announce the newest finished check once, with a saved copy of its results, so
 * the thread always reflects work that finished while nobody was looking and keeps it in
 * scrollback; then return the thread and checklist.
 */
export function openGuide(engine: Engine, projectId: string): Promise<GuideView> {
  return exclusive(projectId, async () => {
    const { runs } = await engine.state(projectId);
    const newest = runs.find(
      (r) => (r.kind === 'report' || r.kind === 'verify') && r.status === 'completed',
    );
    const state = await readSetupState(engine.store, projectId);
    if (newest && newest.id !== state.announcedRunId) {
      const thread = await readThread(engine.store, projectId);
      if (thread.messages.length) {
        const { text, result } = await checkAnnouncement(engine, newest);
        await writeThread(engine.store, projectId, {
          ...thread,
          messages: [
            ...thread.messages,
            { ...guideMessage('event', text), ...(result ? { result } : {}) },
          ],
        });
      }
      await writeSetupState(engine.store, projectId, { ...state, announcedRunId: newest.id });
    }
    return guideView(engine, projectId);
  });
}

/** Record an app fact in the thread, such as a saved URL or a finished check. */
export function recordGuideEvent(
  engine: Engine,
  projectId: string,
  text: string,
): Promise<GuideView> {
  return exclusive(projectId, async () => {
    const thread = await readThread(engine.store, projectId);
    await writeThread(engine.store, projectId, {
      ...thread,
      messages: [...thread.messages, guideMessage('event', text)],
    });
    return guideView(engine, projectId);
  });
}

/** Run a setup change under the Guide's queue, then return the fresh view with an event line. */
export function guideChange(
  engine: Engine,
  projectId: string,
  change: () => Promise<void>,
  event: string,
): Promise<GuideView> {
  return exclusive(projectId, async () => {
    await change();
    const thread = await readThread(engine.store, projectId);
    await writeThread(engine.store, projectId, {
      ...thread,
      messages: [...thread.messages, guideMessage('event', event)],
    });
    return guideView(engine, projectId);
  });
}
