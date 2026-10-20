import { ArrowRight, CircleAlert, Info, SlidersHorizontal } from 'lucide-react';
import { type JSX, useRef, useState } from 'react';

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
  const missing = startHint(workspace);
  const [showModel, setShowModel] = useState(false);
  const model = useRef<HTMLDivElement>(null);
  /** Open the model settings below the box, bring them into view, and focus their first action. */
  function openModel(): void {
    setShowModel(true);
    requestAnimationFrame(() => {
      model.current?.scrollIntoView?.({ block: 'nearest' });
      model.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    });
  }
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
          <button
            className="text-button goal-starter-model"
            aria-expanded={showModel}
            aria-controls="start-model-settings"
            onClick={() => (showModel ? setShowModel(false) : openModel())}
          >
            <SlidersHorizontal size={14} aria-hidden="true" /> Model and effort
          </button>
          <div className="goal-starter-actions">
            <ProviderPicker workspace={workspace} onConnect={openModel} />
            {/* A disabled button gets no hover, so its wrapper says what is still needed. */}
            <span className="goal-starter-start" title={missing || undefined}>
              <button
                className="primary goal-starter-create"
                disabled={busy || !!missing}
                aria-describedby={missing ? 'start-hint' : undefined}
                onClick={() => void start()}
              >
                Hand it to Aiden <ArrowRight size={15} />
              </button>
              <span id="start-hint" hidden>
                {missing}
              </span>
            </span>
          </div>
        </div>
      </div>
      <NotionNotice workspace={workspace} />
      {showModel && (
        <div id="start-model-settings" className="goal-starter-settings" ref={model}>
          <RuntimeSettings
            runtime={project.runtime}
            diagnostics={workspace.diagnostics}
            api={api}
            disabled={busy}
            onRefresh={workspace.refresh}
            onChange={(runtime) => setProject((current) => ({ ...current, runtime }))}
          />
        </div>
      )}
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

/**
 * The provider choice with whether it is connected, read from the loaded diagnostics. When it is
 * not connected, the status itself opens the sign-in steps.
 */
function ProviderPicker({
  workspace,
  onConnect,
}: {
  workspace: Workspace;
  onConnect: () => void;
}): JSX.Element {
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
      {connected === false ? (
        <button
          className="text-button provider-connect"
          aria-label={`Connect ${name}`}
          onClick={onConnect}
        >
          Not connected · Connect
        </button>
      ) : (
        <span
          className={`connection provider-ready ${connected ? 'ready' : ''}`}
          aria-label={`${name} connection`}
        >
          <span />
          {label}
        </span>
      )}
    </>
  );
}

/**
 * What still stops the start, as one short sentence for the button's tooltip, or empty when
 * Aiden can start. The goal and a connected model are required; everything else comes later in
 * the setup chat.
 * Example: an empty box gives "Describe what you are building first."
 */
function startHint(workspace: Workspace): string {
  const { project } = workspace;
  if (!project.context.trim()) return 'Describe what you are building first.';
  if (runtimeReady(workspace.diagnostics, project.runtime) === false)
    return `Connect ${providerName(project.runtime.provider)} first.`;
  return '';
}
