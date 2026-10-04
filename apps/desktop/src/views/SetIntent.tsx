import { ArrowRight, FileText, FolderKanban } from 'lucide-react';
import type { JSX } from 'react';

import brandMark from '../assets/brand-mark.svg';
import RuntimeSettings from '../components/RuntimeSettings';
import type { Workspace } from '../hooks/useWorkspace';
const api = window.aiden;

/**
 * The whole setup: say what you are building and where the code is. Aiden writes what done means
 * and starts looking on its own; there is no review step before it gets to work.
 */
export function SetIntent({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, setProject, busy, scanning, scanProjectFolder, start, action } = workspace;
  const folder = project.rootPath?.split('/').at(-1) || project.rootPath;
  const repos = project.repositories.length;
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
        Paste or type anything that says what you want. Aiden plans usable features in delivery
        order, assesses the code and tracks delivery, and surfaces what needs you. Include your
        target date and constraints if you have them.
      </p>
      <div className="chat-composer">
        <textarea
          className="chat-composer-textarea"
          aria-label="What are you building?"
          placeholder="Paste or type what you are building…"
          maxLength={20000}
          rows={4}
          value={project.context}
          onChange={(event) => setProject({ ...project, context: event.target.value })}
        />
        <div className="chat-composer-footer">
          <button
            className="text-button"
            onClick={() =>
              void action(async () => {
                const text = await api?.chooseContext();
                if (text)
                  setProject((p) => ({
                    ...p,
                    context: p.context ? `${p.context}\n\n${text}` : text,
                  }));
              })
            }
          >
            <FileText size={14} /> Import a file
          </button>
          <button
            className="text-button"
            disabled={scanning}
            onClick={() => void scanProjectFolder(true)}
          >
            <FolderKanban size={14} />
            {scanning
              ? 'Finding repositories…'
              : folder
                ? `${folder} · ${repos} ${repos === 1 ? 'repository' : 'repositories'}`
                : 'Choose the project folder'}
          </button>
          <select
            className="chat-model-select"
            aria-label="Model provider"
            value={project.runtime.provider}
            onChange={(event) =>
              setProject({
                ...project,
                runtime: {
                  provider: event.target.value as 'claude' | 'codex',
                  auth: 'subscription',
                },
              })
            }
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          <button
            className="primary goal-starter-create"
            disabled={busy || scanning || !project.context.trim() || !repos}
            onClick={() => void start()}
          >
            Hand it to Aiden <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <details>
        <summary>Model and effort</summary>
        <RuntimeSettings
          runtime={project.runtime}
          diagnostics={workspace.diagnostics}
          api={api}
          disabled={busy}
          onRefresh={workspace.refresh}
          onChange={(runtime) => setProject((current) => ({ ...current, runtime }))}
        />
      </details>
      {project.discoveryWarnings?.map((warning) => (
        <p className="inline-note" role="status" key={warning}>
          {warning}
        </p>
      ))}
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
