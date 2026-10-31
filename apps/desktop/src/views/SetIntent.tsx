import { ArrowRight, CircleAlert, Info, SlidersHorizontal } from 'lucide-react';
import { type JSX, useEffect, useRef, useState } from 'react';

import type { McpConnection } from '../../../../packages/contracts/src/index';
import {
  notionContext,
  notionLinks,
  notionReadTools,
  notionReady,
} from '../../../../packages/contracts/src/tracker-connections';
import brandMark from '../assets/brand-mark.svg';
import RuntimeSettings from '../components/RuntimeSettings';
import type { Workspace } from '../hooks/useWorkspace';
import { providerName, runtimeReady } from '../renderer/runtime-readiness';
const api = window.aiden;

/** The person's GitHub organizations, or why they could not be listed; null while loading. */
type Orgs = { items: string[] } | { unavailable: string } | null;

/**
 * The whole start: say what you are building, or paste a Notion page link, and pick the GitHub
 * organization the code lives in. Aiden finds the repositories there itself; checks come later
 * in the setup chat, where the person can ask what each step means.
 */
export function SetIntent({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, setProject, busy, start } = workspace;
  const [orgs, reloadOrgs] = useGithubOrganizations(workspace);
  const missing = startHint(workspace, orgs);
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
            <OrgPicker workspace={workspace} orgs={orgs} />
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
      {orgs && 'unavailable' in orgs && (
        <div className="start-blocker" role="status">
          <CircleAlert size={16} />
          <p>{orgs.unavailable}</p>
          <button className="start-blocker-action" onClick={reloadOrgs}>
            Try again
          </button>
        </div>
      )}
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
 * Approve only Notion's page-reading tools for a connected Notion sign-in, the person's one click
 * on the start screen. Every other Notion tool stays unapproved.
 * Example: a connected Notion with nothing approved gets notion-fetch and notion-search.
 */
async function allowNotionReading(workspace: Workspace, notion: McpConnection): Promise<void> {
  const rows = await workspace.call('integrationTools', { connectionId: notion.id });
  const fresh = (await workspace.call('integrations')).find((c) => c.id === notion.id);
  if (!fresh?.toolFingerprint) throw new Error('Notion did not list its tools. Try again.');
  const wanted = new Set<string>(notionReadTools);
  await workspace.call('integrationApprove', {
    connectionId: notion.id,
    fingerprint: fresh.toolFingerprint,
    tools: rows.filter((tool) => tool.readOnly && wanted.has(tool.name)).map((tool) => tool.name),
  });
  workspace.setIntegrations(await workspace.call('integrations'));
}

/**
 * When the goal links Notion pages, say whether Aiden can read them. A connected Notion that still
 * needs its read tools approved gets a one-click allow; otherwise Settings → Integrations opens.
 */
function NotionNotice({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const [allowing, setAllowing] = useState(false);
  const [failed, setFailed] = useState('');
  const links = notionLinks(workspace.project.context).length;
  if (!links) return null;
  const notion = workspace.integrations.find(notionContext);
  const ready = !!notion && notionReady(notion);
  const signedIn = notion?.status === 'connected';
  const pages = links === 1 ? 'this Notion page' : `these ${links} Notion pages`;
  /** Approve the read tools, keeping any failure on the notice. */
  async function allow(): Promise<void> {
    if (!notion) return;
    setAllowing(true);
    setFailed('');
    try {
      await allowNotionReading(workspace, notion);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Could not allow Notion reading.');
    } finally {
      setAllowing(false);
    }
  }
  return (
    <div className={ready ? 'start-blocker start-note' : 'start-blocker'} role="status">
      {ready ? <Info size={16} /> : <CircleAlert size={16} />}
      <p>
        {ready
          ? `Aiden will read ${pages} when it writes the requirements.`
          : signedIn
            ? `To read ${pages}, allow Aiden to read Notion pages. Only Notion's fetch and search tools are approved.`
            : `To read ${pages}, connect Notion in Settings → Integrations.`}
        {failed && <span className="start-blocker-fix"> {failed}</span>}
      </p>
      {!ready &&
        (signedIn ? (
          <button className="start-blocker-action" disabled={allowing} onClick={() => void allow()}>
            {allowing ? 'Allowing…' : 'Allow reading Notion pages'}
          </button>
        ) : (
          <button
            className="start-blocker-action"
            onClick={() => {
              workspace.setSettingsTab('integrations');
              workspace.setArea('settings');
            }}
          >
            Open Integrations
          </button>
        ))}
    </div>
  );
}

/**
 * Load the person's GitHub organizations, and choose the only one whenever the project has none,
 * including after Create project starts a fresh one. Returns the listing and a way to try again
 * after signing in to GitHub.
 */
function useGithubOrganizations(workspace: Workspace): [Orgs, () => void] {
  const { call, setProject, project } = workspace;
  const [orgs, setOrgs] = useState<Orgs>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void call('githubOrganizations', {}).then(
      (found) => live && setOrgs(found),
      () => live && setOrgs({ unavailable: 'Aiden could not reach GitHub. Try again.' }),
    );
    return () => {
      live = false;
    };
  }, [call, attempt]);
  const only = orgs && 'items' in orgs && orgs.items.length === 1 ? orgs.items[0] : undefined;
  const chosen = !!project.githubOrganizations?.length;
  useEffect(() => {
    if (only && !chosen)
      setProject((current) =>
        current.githubOrganizations?.length ? current : { ...current, githubOrganizations: [only] },
      );
  }, [only, chosen, setProject]);
  /** List the organizations again, for example after `gh auth login`. */
  const reload = () => {
    setOrgs(null);
    setAttempt((n) => n + 1);
  };
  return [orgs, reload];
}

/** The required GitHub organization, next to the provider: only the organizations they belong to. */
function OrgPicker({ workspace, orgs }: { workspace: Workspace; orgs: Orgs }): JSX.Element {
  const { project, setProject } = workspace;
  const items = orgs && 'items' in orgs ? orgs.items : [];
  return (
    <select
      className="chat-model-select"
      aria-label="GitHub organization"
      value={project.githubOrganizations?.[0] ?? ''}
      disabled={!items.length}
      onChange={(event) => setProject({ ...project, githubOrganizations: [event.target.value] })}
    >
      <option value="" disabled>
        {orgs === null ? 'Finding orgs…' : 'GitHub org'}
      </option>
      {items.map((org) => (
        <option key={org} value={org}>
          {org}
        </option>
      ))}
    </select>
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
 * Aiden can start. The goal, the GitHub organization, and a connected model are required;
 * everything else comes later in the setup chat.
 * Example: an empty box gives "Describe what you are building first."
 */
function startHint(workspace: Workspace, orgs: Orgs): string {
  const { project } = workspace;
  if (!project.context.trim()) return 'Describe what you are building first.';
  if (!project.githubOrganizations?.length)
    return orgs === null
      ? 'Finding your GitHub organizations.'
      : 'unavailable' in orgs
        ? orgs.unavailable
        : 'Choose the GitHub organization first.';
  if (runtimeReady(workspace.diagnostics, project.runtime) === false)
    return `Connect ${providerName(project.runtime.provider)} first.`;
  return '';
}
