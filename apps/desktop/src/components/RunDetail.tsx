import { ArrowLeft, Square } from 'lucide-react';
import { type JSX, useEffect, useRef, useState } from 'react';

import type {
  ActivityEntry,
  ChatMessage,
  RunEvent,
  RunManifest,
} from '../../../../packages/contracts/src/index';
import { useNow } from '../hooks/useNow';
import type { Workspace } from '../hooks/useWorkspace';
import { runBlockage } from '../renderer/run-blockers';
import { duration, runReasons, runStages, runStatus, runTitle } from '../renderer/run-labels';
import { clockTime } from '../renderer/time';
import { RunBlockers } from './RunBlockers';
import { RunChat } from './RunChat';
const api = window.aiden;

/** Show the provider, actual model when known, and effort captured when this run started. */
function RunRuntime({ run }: { run: RunManifest }): JSX.Element {
  const runtime = run.project.runtime;
  return (
    <p className="fine-print">
      {runtime.provider === 'claude' ? 'Claude Code' : 'Codex'} ·{' '}
      {run.runtimeModel ?? runtime.model ?? 'Provider default'} · Effort:{' '}
      {runtime.effort ?? 'Provider default'}
      {run.beta && (
        <>
          {' '}
          · Beta deployment: <code>{run.beta.revision.slice(0, 12)}</code>
        </>
      )}
    </p>
  );
}

/** Where the run is among its stages: done, now, or still to come. */
function Stages({ run, active }: { run: RunManifest; active: boolean }): JSX.Element {
  const stages = runStages[run.kind];
  const finished = run.status === 'completed' || run.stage === 'complete';
  const current = stages.findIndex((s) => s.stage === run.stage);
  return (
    <ol className="run-stages" aria-label="Stages">
      {stages.map((s, i) => {
        const state =
          finished || (current >= 0 && i < current)
            ? 'done'
            : i === current
              ? active
                ? 'now'
                : 'stopped'
              : 'todo';
        return (
          <li key={s.stage} className={`stage stage--${state}`}>
            <span aria-hidden="true" />
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

/** Keep a run's history current: load it, then add each step as the worker reports it. */
function useRunLog(workspace: Workspace, runId: string): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const { project, call, setError } = workspace;
  useEffect(() => {
    let cancelled = false;
    void call('runLog', { projectId: project.id, runId })
      .then((log) => !cancelled && setEntries(log))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the run.'));
    const stop = api?.onEvent((event: RunEvent) => {
      const entry = event.activity;
      if (event.type !== 'activity' || event.runId !== runId || !entry) return;
      setEntries((log) =>
        log.some((e) => e.at === entry.at && e.summary === entry.summary) ? log : [...log, entry],
      );
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [call, project.id, runId, setError]);
  return entries;
}

/**
 * One run in full: what it is doing right now, how far it got, every step it took as it happens,
 * and a conversation to ask why.
 */
export function RunDetail({
  workspace,
  run,
  active,
}: {
  workspace: Workspace;
  run: RunManifest;
  active: boolean;
}): JSX.Element {
  const { project, call, action, setOpenRun } = workspace;
  const entries = useRunLog(workspace, run.id);
  const now = useNow(active);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState('');
  const [error, setError] = useState('');
  const end = useRef<HTMLLIElement>(null);
  const last = entries.at(-1);
  const startedAt = Date.parse(run.createdAt);
  const endedAt = active ? now : Date.parse(last?.at ?? run.createdAt);
  const blockage = runBlockage(run, workspace.calls, workspace.baseline);
  const status = runStatus(run, active, blockage);
  const waitingOnAnswer = !!blockage;
  useEffect(() => {
    if (active && !waitingOnAnswer) end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active, entries.length, waitingOnAnswer]);
  useEffect(() => {
    void call('chat', { projectId: project.id, runId: run.id }).then(setChat, () => {});
  }, [call, project.id, run.id]);
  /** Send a question about this run and show the answer, or why there is none. */
  const ask = async (request: () => Promise<ChatMessage[]>, question: string) => {
    setAsking(question);
    setError('');
    try {
      setChat(await request());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aiden could not answer.');
    } finally {
      setAsking('');
    }
  };
  return (
    <div className="run-detail">
      <button className="text-button" onClick={() => setOpenRun('')}>
        <ArrowLeft size={13} aria-hidden="true" /> All runs
      </button>
      <header className="brief-top">
        <div>
          <h1>{runTitle(run, active)}</h1>
          <p className="brief-when">
            Started {clockTime(run.createdAt)}
            {run.reason ? `, ${runReasons[run.reason]}` : ''} · {duration(endedAt - startedAt)}
            {active ? ' so far' : ''}
          </p>
        </div>
        <span className={`chip chip--${status.tone}`}>{status.label}</span>
      </header>
      <RunRuntime run={run} />
      {blockage && <RunBlockers blockage={blockage} workspace={workspace} />}
      <section className="brief-card" aria-label="Progress">
        <Stages run={run} active={active} />
        {active && (
          <p className="live-line" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span>
              Now: {last?.summary ?? 'Starting'}
              <small> · {duration(now - Date.parse(last?.at ?? run.createdAt))} on this step</small>
            </span>
            <button
              className="text-button"
              onClick={() =>
                void action(async () => void (await call('cancel', { runId: run.id })))
              }
            >
              <Square size={10} aria-hidden="true" /> Stop
            </button>
          </p>
        )}
        {run.error && !active && <p className="brief-note">{run.error}</p>}
      </section>
      <section className="brief-card" aria-label="Full history">
        <h2 className="card-label">Full history · {entries.length} steps</h2>
        <ol className="run-history">
          {entries.map((entry) => (
            <li key={`${entry.at}-${entry.summary}`} className={`log-line log-${entry.kind}`}>
              <time dateTime={entry.at}>{clockTime(entry.at)}</time>
              <span>{entry.summary}</span>
              <span className="log-actions">
                {entry.kind !== 'step' && (
                  <button
                    className="text-button"
                    aria-label={`Why: ${entry.summary}`}
                    onClick={() =>
                      void ask(
                        () =>
                          call('explain', {
                            projectId: project.id,
                            runId: run.id,
                            at: entry.at,
                            summary: entry.summary,
                          }),
                        `Why: ${entry.summary}`,
                      )
                    }
                  >
                    Why?
                  </button>
                )}
              </span>
            </li>
          ))}
          <li ref={end} aria-hidden="true" />
        </ol>
      </section>
      <section className="brief-card" aria-label="Conversation">
        <h2 className="card-label">Ask about this run</h2>
        <RunChat
          messages={chat}
          thinking={!!asking}
          asking={asking}
          error={error}
          onAsk={(question) =>
            ask(() => call('askWhy', { projectId: project.id, runId: run.id, question }), question)
          }
        />
      </section>
    </div>
  );
}
