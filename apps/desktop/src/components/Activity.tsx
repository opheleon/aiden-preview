import { Copy, MessageCircle, Play } from 'lucide-react';
import { type JSX, type ReactNode, useState } from 'react';

import type {
  ActivityEntry,
  ChatMessage,
  RunManifest,
} from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import { runReasons as reasons, runTitles } from '../renderer/run-labels';
import { clockTime } from '../renderer/time';
import { RunChat } from './RunChat';

/** Runs shown before "Show earlier". */
const pageSize = 8;

/** One run's lines, in the order they happened. */
interface RunGroup {
  runId: string;
  entries: ActivityEntry[];
}

/** Group newest-first entries by run, keeping runs newest first and lines oldest first. */
function groups(entries: ActivityEntry[]): RunGroup[] {
  const byRun = new Map<string, ActivityEntry[]>();
  for (const entry of entries) byRun.set(entry.runId, [...(byRun.get(entry.runId) ?? []), entry]);
  return [...byRun].map(([runId, lines]) => ({ runId, entries: [...lines].reverse() }));
}

/** The per-run conversation state kept while the brief is open. */
interface ChatState {
  open: string | null;
  chats: Record<string, ChatMessage[]>;
  thinking: string | null;
  /** The question being answered, shown straight away while Aiden works on it. */
  asking: string;
  error: string;
}

/** A run's header, its lines with Why? on each, and its conversation when open. */
function RunLog({
  group,
  run,
  chat,
  onWhy,
  onOpen,
  onAsk,
  onWatch,
  onOpenRun,
}: {
  group: RunGroup;
  run: RunManifest | undefined;
  chat: ChatState;
  /** Open the run's full history. */
  onOpenRun: () => void;
  onWhy: (entry: ActivityEntry) => void;
  onOpen: () => void;
  onAsk: (question: string) => Promise<void>;
  onWatch: (key: string) => void;
}): JSX.Element {
  const first = group.entries[0]!;
  const why = run?.reason ? ` · ${reasons[run.reason]}` : '';
  return (
    <li className="run-log">
      <div className="run-log-head">
        <button className="run-log-title" onClick={onOpenRun}>
          {run ? runTitles[run.kind] : 'Earlier work'}
        </button>
        <span>
          {clockTime(first.at)}
          {why}
        </span>
        <button className="text-button" onClick={onOpen}>
          <MessageCircle size={13} aria-hidden="true" /> Ask about this
        </button>
      </div>
      <ol>
        {group.entries.map((entry) => (
          <li key={`${entry.at}-${entry.summary}`} className={`log-line log-${entry.kind}`}>
            <time dateTime={entry.at}>{clockTime(entry.at)}</time>
            <span>
              {entry.summary}
              {entry.reconstructed && <em> Rebuilt from saved history.</em>}
            </span>
            <span className="log-actions">
              {entry.evidence && (
                <button
                  className="text-button"
                  aria-label={`Watch ${entry.evidence}`}
                  onClick={() => onWatch(entry.evidence!)}
                >
                  <Play size={11} aria-hidden="true" /> Watch
                </button>
              )}
              <button
                className="text-button"
                aria-label={`Why: ${entry.summary}`}
                onClick={() => onWhy(entry)}
              >
                Why?
              </button>
            </span>
          </li>
        ))}
      </ol>
      {chat.open === group.runId && (
        <RunChat
          messages={chat.chats[group.runId] ?? []}
          thinking={chat.thinking === group.runId}
          asking={chat.thinking === group.runId ? chat.asking : ''}
          error={chat.error}
          onAsk={onAsk}
        />
      )}
    </li>
  );
}

/**
 * What Aiden did, one card per brief: runs newest first, each line with Why?. Why? opens that
 * run's conversation, answered from the reason Aiden recorded or from the run's saved record.
 */
export function Activity({
  entries,
  runs,
  projectId,
  call,
  update,
  onWatch,
  onOpenRun,
  deliveryActivity,
}: {
  entries: ActivityEntry[];
  runs: RunManifest[];
  projectId: string;
  call: DesktopBridge['request'];
  /** The status update to copy for stakeholders; empty before the first brief. */
  update: string;
  onWatch: (key: string) => void;
  /** Open one run's full history. */
  onOpenRun: (runId: string) => void;
  deliveryActivity?: ReactNode;
}): JSX.Element {
  const [shown, setShown] = useState(pageSize);
  const [copied, setCopied] = useState(false);
  const [chat, setChat] = useState<ChatState>({
    open: null,
    chats: {},
    thinking: null,
    asking: '',
    error: '',
  });
  /** Run one chat request for a run, keeping its messages and surfacing failures inline. */
  const talk = async (runId: string, request: () => Promise<ChatMessage[]>, asking = '') => {
    setChat((c) => ({ ...c, open: runId, thinking: runId, asking, error: '' }));
    try {
      const messages = await request();
      setChat((c) => ({ ...c, chats: { ...c.chats, [runId]: messages }, thinking: null }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Aiden could not answer.';
      setChat((c) => ({ ...c, thinking: null, error: message }));
    }
  };
  const all = groups(entries);
  return (
    <section className="brief-card" aria-label="Activity">
      <div className="card-label-row">
        <h2 className="card-label">Activity</h2>
        {update && (
          <button
            className="text-button"
            onClick={() => void navigator.clipboard.writeText(update).then(() => setCopied(true))}
          >
            <Copy size={12} aria-hidden="true" /> {copied ? 'Copied' : 'Copy update'}
          </button>
        )}
      </div>
      {deliveryActivity}
      {all.length ? (
        <ol className="run-logs">
          {all.slice(0, shown).map((group) => (
            <RunLog
              key={group.runId}
              group={group}
              run={runs.find((r) => r.id === group.runId)}
              chat={chat}
              onWatch={onWatch}
              onOpenRun={() => onOpenRun(group.runId)}
              onOpen={() =>
                void talk(group.runId, () => call('chat', { projectId, runId: group.runId }))
              }
              onWhy={(entry) =>
                void talk(
                  group.runId,
                  () =>
                    call('explain', {
                      projectId,
                      runId: group.runId,
                      at: entry.at,
                      summary: entry.summary,
                    }),
                  `Why: ${entry.summary}`,
                )
              }
              onAsk={(question) =>
                talk(
                  group.runId,
                  () => call('askWhy', { projectId, runId: group.runId, question }),
                  question,
                )
              }
            />
          ))}
        </ol>
      ) : (
        !deliveryActivity && (
          <p className="card-empty">Nothing yet. Aiden logs every step here as it works.</p>
        )
      )}
      {all.length > shown && (
        <button className="text-button" onClick={() => setShown(shown + pageSize)}>
          Show earlier
        </button>
      )}
      {update && (
        <p className="teams-edge">
          On Teams, everyone who asks where this stands sees it here, without you sending anything.
        </p>
      )}
    </section>
  );
}
