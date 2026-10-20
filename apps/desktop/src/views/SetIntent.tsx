import { ArrowRight, CircleAlert, Info } from 'lucide-react';
import { type JSX, useRef } from 'react';

import {
  notionContext,
  notionLinks,
  notionReady,
} from '../../../../packages/contracts/src/tracker-connections';
import brandMark from '../assets/brand-mark.svg';
import RuntimeSettings from '../components/RuntimeSettings';
import type { Workspace } from '../hooks/useWorkspace';
import { providerName, runtimeReady } from '../renderer/runtime-readiness';
const api = window.aiden;

/**
 * The whole start: say what you are building, or paste a Notion page link. Code folders and checks
 * come later in the setup chat, where the person can ask what each step means.
 */
export function SetIntent({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, setProject, busy, start } = workspace;
  const blocker = startHint(workspace);
  const missing = blocker?.blocking ? blocker.why : '';
  const model = useRef<HTMLDetailsElement>(null);
  return (
    <section className="goal-starter set-intent" aria-label="New project">
      <div className="goal-starter-brand">
        <img src={brandMark} alt="" />
        <strong>Aiden</strong>
        <span className="mono">by Opheleon</span>
      </div>
      <h1>
        What are you <span className="serif">building?</span>
      </h1>
      <p className="goal-starter-lead">
        Paste or type anything that says what you want, or paste a link to a Notion page and Aiden
        reads it. Aiden plans usable features in delivery order, assesses the code and tracks
        delivery, and surfaces what needs you. Include your target date and constraints if you have
        them.
      </p>
      <div className="chat-composer">
        <textarea
          className="chat-composer-textarea"
          aria-label="What are you building?"
          placeholder="Describe what you are building, or paste a Notion page link…"
          maxLength={20000}
          rows={4}
          value={project.context}
          onChange={(event) => setProject({ ...project, context: event.target.value })}
        />
        <div className="chat-composer-footer">
          <ProviderPicker workspace={workspace} />
          <button
            className="primary goal-starter-create"
            disabled={busy || !!blocker.blocking}
            aria-describedby={missing ? 'start-hint' : undefined}
            onClick={() => void start()}
          >
            Hand it to Aiden <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <NotionNotice workspace={workspace} />
      <StartBlocker blocker={blocker} onConnect={() => openModelControls(model.current)} />
      <details ref={model}>
        <summary>Model connection and effort</summary>
        <RuntimeSettings
          runtime={project.runtime}
          diagnostics={workspace.diagnostics}
          api={api}
          disabled={busy}
          onRefresh={workspace.refresh}
          onChange={(runtime) => setProject((current) => ({ ...current, runtime }))}
        />
      </details>
      <div className="goal-starter-next">
        <span>
          <b>You</b> set the goal
        </span>
        <span>
          <b>You</b> make the calls
        </span>
        <span>
          <b>You</b> accept the outcome
        </span>
        <span>
          <b>Aiden</b> does the rest
        </span>
      </div>
    </section>
  );
}

/**
 * When the goal links Notion pages, say whether Aiden can read them, and open Settings →
 * Integrations when Notion still needs connecting or its read tools need approving.
 */
function NotionNotice({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const links = notionLinks(workspace.project.context).length;
  if (!links) return null;
  const notion = workspace.integrations.find(notionContext);
  const ready = !!notion && notionReady(notion);
  const pages = links === 1 ? 'this Notion page' : `these ${links} Notion pages`;
  return (
    <div className={ready ? 'start-blocker start-note' : 'start-blocker'} role="status">
      {ready ? <Info size={16} /> : <CircleAlert size={16} />}
      <p>
        {ready
          ? `Aiden will read ${pages} when it writes the requirements.`
          : notion
            ? `To read ${pages}, approve Notion's read tools in Settings → Integrations.`
            : `To read ${pages}, connect Notion in Settings → Integrations.`}
      </p>
      {!ready && (
        <button
          className="start-blocker-action"
          onClick={() => {
            workspace.setSettingsTab('integrations');
            workspace.setArea('settings');
          }}
        >
          Open Integrations
        </button>
      )}
    </div>
  );
}

/** The provider choice with whether it is connected, read from the loaded diagnostics. */
function ProviderPicker({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, setProject } = workspace;
  const name = providerName(project.runtime.provider);
  const connected = runtimeReady(workspace.diagnostics, project.runtime);
  const label = connected ? 'Connected' : connected === false ? 'Not connected' : 'Checking…';
  return (
    <>
      <select
        className="chat-model-select"
        aria-label="Model provider"
        value={project.runtime.provider}
        onChange={(event) =>
          setProject({
            ...project,
            runtime: { provider: event.target.value as 'claude' | 'codex', auth: 'subscription' },
          })
        }
      >
        <option value="codex">Codex</option>
        <option value="claude">Claude</option>
      </select>
      <span
        className={`connection provider-ready ${connected ? 'ready' : ''}`}
        aria-label={`${name} connection`}
      >
        <span />
        {label}
      </span>
    </>
  );
}

/** Open the model connection controls, bring them into view, and focus their first action. */
function openModelControls(details: HTMLDetailsElement | null): void {
  if (!details) return;
  details.open = true;
  details.scrollIntoView?.({ block: 'nearest' });
  details.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
}

/** Something the person should know before starting: a blocker, or a note that does not block. */
interface StartBlockerInfo {
  why: string;
  fix: string;
  /** The selected provider needs connecting; offers to open the model connection controls. */
  connect?: string;
  blocking: boolean;
}

/**
 * Say what is still needed before Aiden can start, or what happens after. The goal and a connected
 * model are required; everything else, including the code folders, comes in the setup chat.
 * Example: an empty box blocks; Claude not signed in blocks and offers to connect it.
 */
function startHint(workspace: Workspace): StartBlockerInfo {
  const { project } = workspace;
  const connected = runtimeReady(workspace.diagnostics, project.runtime);
  const name = providerName(project.runtime.provider);
  if (!project.context.trim())
    return {
      why: 'To start, describe what you are building.',
      fix: 'Type or paste your goal in the box above, or paste a Notion page link.',
      blocking: true,
    };
  if (connected === false)
    return {
      why: `Connect ${name} before handing this to Aiden.`,
      fix: `Aiden works through your own ${name} account. Install it if needed and sign in; your subscription or API-key billing applies.`,
      connect: name,
      blocking: true,
    };
  return {
    why: 'What happens next: Aiden plays back the requirements for you to confirm, asks you to connect your code so it can estimate the work, then asks how to check it.',
    fix: 'Each step is in the setup chat, where you can ask what it means. Nothing else is needed here.',
    blocking: false,
  };
}

/**
 * Explain prominently why the start button is disabled and how to fix it, or what happens next.
 * Example: an empty intent shows the reason and the fix; a signed-out model offers to connect it.
 */
function StartBlocker({
  blocker,
  onConnect,
}: {
  blocker: StartBlockerInfo;
  onConnect: () => void;
}): JSX.Element {
  return (
    <div className={blocker.blocking ? 'start-blocker' : 'start-blocker start-note'}>
      {blocker.blocking ? <CircleAlert size={16} /> : <Info size={16} />}
      <div>
        <p id={blocker.blocking ? 'start-hint' : undefined}>{blocker.why}</p>
        <p className="start-blocker-fix">{blocker.fix}</p>
      </div>
      {blocker.connect && (
        <button className="start-blocker-action" onClick={onConnect}>
          Connect {blocker.connect}
        </button>
      )}
    </div>
  );
}
