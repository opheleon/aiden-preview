import { ArrowDown, RotateCcw } from 'lucide-react';
import { type JSX, type RefObject, useEffect, useRef } from 'react';

import {
  distinctGuideWidgets,
  type GuideMessage,
  type GuideWidget,
  type SetupProgress,
  type SetupStepId,
} from '../../../../packages/contracts/src/guide';
import { ChatStatusLine } from '../components/ChatStatusLine';
import { ChatSteps } from '../components/ChatSteps';
import { GuideClarification } from '../components/GuideClarification';
import { GuideComposer } from '../components/GuideComposer';
import { GuideResultEntry, guideResultId } from '../components/GuideResultEntry';
import { GuideRunStatus } from '../components/GuideRunStatus';
import { GuideThinking } from '../components/GuideThinking';
import { GuideWidgetCard } from '../components/GuideWidgets';
import { ProjectChatAction } from '../components/ProjectChatAction';
import { ProviderNotice } from '../components/ProviderNotice';
import type { Guide } from '../hooks/useGuide';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { useTeamSetupSync } from '../hooks/useTeamSetupSync';
import type { Workspace } from '../hooks/useWorkspace';
import { contextualGuideMessage, type ProjectChatEntry } from '../renderer/project-chat-entry';

/** Point back to the Chat tab from the Overview tab while setup is unfinished. */
export function SetupBanner({
  setup,
  onOpen,
}: {
  setup: SetupProgress | undefined;
  onOpen: () => void;
}): JSX.Element | null {
  if (!setup || setup.complete) return null;
  const next = setup.steps.find((s) => s.id === setup.next);
  return (
    <div className="start-blocker start-note setup-banner">
      <span>
        <b>Finish setup:</b> {next?.detail ?? 'A few steps are left.'}
      </span>
      <button className="start-blocker-action" onClick={() => onOpen()}>
        Go to Chat
      </button>
    </div>
  );
}

/** Status lines under the thread: thinking, an unanswered message, or an error. */
function ThreadStatus({ guide, waiting }: { guide: Guide; waiting: boolean }): JSX.Element {
  return (
    <>
      {guide.asking && <p className="chat-you">{guide.asking}</p>}
      {guide.thinking && <GuideThinking doing={guide.doing} />}
      {waiting && (
        <p className="guide-event">
          No reply yet.{' '}
          <button className="text-button" onClick={() => void guide.retry()}>
            <RotateCcw size={13} /> Ask again
          </button>
        </p>
      )}
      {guide.error && !guide.thinking && (
        <div role="alert" className="guide-turn-error">
          <p>{guide.error}</p>
          {!waiting && (
            <button className="text-button" onClick={() => void guide.retry()}>
              <RotateCcw size={13} /> Try again
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** One line of the thread: your messages, the Guide's replies, and facts the app recorded. */
function Line({
  message,
  workspace,
}: {
  message: GuideMessage;
  workspace: Workspace;
}): JSX.Element {
  if (message.from === 'you') return <p className="chat-you">{message.text}</p>;
  if (message.from === 'event' && message.result)
    return <GuideResultEntry text={message.text} result={message.result} workspace={workspace} />;
  if (message.from === 'event') return <p className="guide-event">{message.text}</p>;
  return (
    <>
      <p className="chat-aiden guide-reply">{message.text}</p>
      <ChatSteps steps={message.nextSteps} />
    </>
  );
}

/**
 * Whether to show a quiet "Thinking" while the requirements load. A team project's requirements
 * come from a team task, whose own status line says what is happening, so it never shows here.
 */
function loadingRequirements(guide: Guide, workspace: Workspace): boolean {
  if (workspace.project.account || guide.thinking || guide.error || workspace.busy) return false;
  return !guide.view || !workspace.baseline;
}

/** Derive the current conversational state without treating old cards as active setup. */
function conversationState(guide: Guide) {
  const messages = guide.view?.thread.messages ?? [];
  const lastReply = messages.map((m) => m.from).lastIndexOf('aiden');
  const lastPerson = messages.filter((m) => m.from !== 'event').at(-1);
  return {
    messages,
    lastReply,
    clarifying: !!guide.view?.clarifications?.length || !!guide.view?.requirementsPending,
    waiting: !guide.thinking && !guide.asking && lastPerson?.from === 'you',
    widgets: distinctGuideWidgets(messages[lastReply]?.widgets ?? []),
  };
}

/**
 * The cards under the newest reply. The confirm, code, and checks steps always show their own
 * card, whatever the reply attached, so setup never stalls on a reply that forgot it.
 */
function stepWidgets(
  next: SetupStepId | null | undefined,
  attached: GuideWidget[],
  busy: boolean,
): GuideWidget[] {
  if (next === 'confirm') return busy ? [] : [{ type: 'confirm-requirements' }];
  if (next === 'code') return [{ type: 'connect-code' }];
  /** A card that sets up how the work is checked, as opposed to a link or the run button. */
  const setupCard = (widget: GuideWidget) =>
    widget.type !== 'run-check' && widget.type !== 'link' && widget.type !== 'confirm-requirements';
  if (next === 'verify' && !attached.some(setupCard))
    return [{ type: 'verify-options' }, ...attached.filter((w) => w.type === 'link')];
  return attached;
}

/** Show just the current question or next action beneath the conversation. */
function CurrentGuideControls({
  workspace,
  guide,
  onCompose,
  onHelp,
}: {
  workspace: Workspace;
  guide: Guide;
  onCompose: (text: string) => void;
  onHelp: () => void;
}): JSX.Element | null {
  const state = conversationState(guide);
  const awaitingReply = guide.thinking || (guide.ready && !guide.error);
  if (state.clarifying)
    return (
      <div hidden={awaitingReply}>
        <GuideClarification guide={guide} busy={workspace.busy} />
      </div>
    );
  if (awaitingReply || state.waiting) return null;
  // While Aiden reads the code, setup keeps going: only cards that start or confirm work wait.
  const widgets = stepWidgets(guide.view?.setup.next, state.widgets, workspace.busy).filter(
    (widget) =>
      !workspace.busy || (widget.type !== 'run-check' && widget.type !== 'confirm-requirements'),
  );
  return (
    <>
      {widgets.map((widget) => (
        <GuideWidgetCard
          key={widget.type}
          widget={widget}
          workspace={workspace}
          guide={guide}
          onHelp={onHelp}
          onCompose={onCompose}
        />
      ))}
    </>
  );
}

/**
 * The project Guide: a setup checklist on top and one long-lived conversation below. Setup cards
 * appear under the newest reply only, so older cards never act on stale choices.
 */
export function GuideChat({
  workspace,
  guide,
  visible,
  chosen = false,
  entry,
  draft,
  setDraft,
  onClearEntry,
  onHelp,
}: {
  workspace: Workspace;
  guide: Guide;
  /** The chat is on screen; only then does the Guide play back the requirements. */
  visible: boolean;
  /** The person opened the chat themselves, so a checked project may play back too. */
  chosen?: boolean;
  entry: ProjectChatEntry | null;
  /** The unsent message, owned above the page so it survives leaving the project. */
  draft: string;
  setDraft: (text: string) => void;
  onClearEntry: () => void;
  onHelp: () => void;
}): JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const latestReply = useRef<HTMLDivElement>(null);
  const requestedAction = useRef<HTMLDivElement>(null);
  const { ready, playback } = guide;
  // A checked project opens on Chat without spending a playback turn unless the person chose it.
  const checked = workspace.runs.some(
    (run) => (run.kind === 'report' || run.kind === 'verify') && run.status === 'completed',
  );
  const autoPlayback = chosen || !checked;
  useEffect(() => {
    if (visible && ready && autoPlayback && passive(entry)) playback();
  }, [visible, ready, autoPlayback, playback, entry]);
  const { view, thinking } = guide;
  useTeamSetupSync(workspace, view);
  const missingRequirement = requirementMissing(entry, workspace);
  const { messages, lastReply, waiting } = conversationState(guide);
  const saved = new Set(messages.flatMap((m) => (m.result ? [m.result.runId] : [])));
  const { following, hold, follow, behind } = useStickToBottom(thread, visible);
  useEffect(() => {
    if (entry) follow();
  }, [entry, follow]);
  useResultFocus({ threadRef: thread, followingRef: following, visible, entry, onClearEntry });
  // A requested action, or a reply taller than the thread, opens at its top; anything else follows.
  useEffect(() => {
    const element = thread.current;
    if (!visible || !element || !following.current || entry?.type === 'result') return;
    if (entry && requestedAction.current) {
      hold(
        requestedAction.current.querySelector('[data-guide-entry-target] input[type="url"]') ??
          requestedAction.current,
      );
      return;
    }
    const reply = latestReply.current;
    if (!thinking && !workspace.busy && reply && reply.clientHeight > element.clientHeight)
      hold(reply);
    else follow();
  }, [visible, messages.length, thinking, workspace.busy, entry, following, hold, follow]);
  /** Put text in the composer, for "Change something" and similar prompts. */
  function compose(text: string): void {
    setDraft(text);
    input.current?.focus();
  }
  return (
    <div className="guide-tab">
      <ProviderNotice workspace={workspace} />
      <div className="guide-thread" ref={thread} role="log" aria-label="Conversation with Aiden">
        {loadingRequirements(guide, workspace) && <GuideThinking />}
        {view?.thread.summary && (
          <p className="guide-event">Earlier in this conversation: {view.thread.summary}</p>
        )}
        {messages.map((m, index) => (
          <div
            className={`guide-message guide-message-${m.from}`}
            key={`${m.at}-${index}`}
            ref={index === lastReply ? latestReply : undefined}
          >
            <Line message={m} workspace={workspace} />
          </div>
        ))}
        {passive(entry) && (
          <CurrentGuideControls
            workspace={workspace}
            guide={guide}
            onCompose={compose}
            onHelp={onHelp}
          />
        )}
        <ThreadStatus guide={guide} waiting={waiting} />
        <GuideRunStatus workspace={workspace} visible={visible} saved={saved} />
        {entry && (
          <div ref={requestedAction}>
            <ProjectChatAction
              entry={entry}
              workspace={workspace}
              guide={guide}
              onDone={onClearEntry}
            />
          </div>
        )}
      </div>
      {behind && (
        <button className="guide-jump" onClick={follow}>
          New messages <ArrowDown size={13} aria-hidden="true" />
        </button>
      )}
      <ChatStatusLine workspace={workspace} setup={view?.setup} />
      <GuideComposer
        input={input}
        maxLength={2000 - contextualGuideMessage(entry, '').length}
        draft={draft}
        onChange={setDraft}
        disabled={thinking || !workspace.baseline || missingRequirement}
        onSend={(text) => {
          follow();
          if (entry) {
            void guide.ask(contextualGuideMessage(entry, text));
            onClearEntry();
            return;
          }
          const question = view?.clarifications?.[0];
          if (question?.options.includes(text)) void guide.answer(question.id, text);
          else void guide.ask(text);
        }}
      />
    </div>
  );
}

/** Scroll the thread so the target's top edge sits at the top of the visible thread. */
function scrollToTarget(thread: HTMLElement, target: Element): void {
  thread.scrollTop =
    target.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
}

/**
 * Bring a saved check result into view and focus when another page asks for it, then stop
 * following new messages so the result stays on screen.
 */
function useResultFocus({
  threadRef,
  followingRef,
  visible,
  entry,
  onClearEntry,
}: {
  threadRef: RefObject<HTMLDivElement | null>;
  followingRef: RefObject<boolean>;
  visible: boolean;
  entry: ProjectChatEntry | null;
  onClearEntry: () => void;
}): void {
  useEffect(() => {
    const element = threadRef.current;
    if (!visible || !element || entry?.type !== 'result') return;
    const target = element.querySelector<HTMLElement>(`#${guideResultId(entry.runId)}`);
    if (target) {
      followingRef.current = false;
      scrollToTarget(element, target);
      target.focus({ preventScroll: true });
    }
    onClearEntry();
  }, [threadRef, followingRef, visible, entry, onClearEntry]);
}

/** An entry that asks for no focused action, so the usual setup controls and playback apply. */
function passive(entry: ProjectChatEntry | null): boolean {
  return !entry || entry.type === 'run' || entry.type === 'result';
}

/** Disable edits when a selected requirement has been removed from the current scope. */
function requirementMissing(entry: ProjectChatEntry | null, workspace: Workspace): boolean {
  return (
    entry?.type === 'requirement' &&
    !workspace.baseline?.product.requirements.some((item) => item.id === entry.requirementId)
  );
}
