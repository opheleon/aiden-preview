import { ArrowRight, CircleAlert, FileText, FolderKanban, Info } from 'lucide-react';
import type { JSX } from 'react';

import brandMark from '../assets/brand-mark.svg';
import RuntimeSettings from '../components/RuntimeSettings';
import type { Workspace } from '../hooks/useWorkspace';
const api = window.aiden;

/**
 * The whole start: say what you are building. The project folder is optional; after the start the
 * Guide plays back the requirements and asks how the work should be checked.
 */
export function SetIntent({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, setProject, busy, scanning, scanProjectFolder, start, action } = workspace;
  const folder = project.rootPath?.split(/[\\/]/).at(-1) || project.rootPath;
  const repos = project.repositories.length;
  const blocker = scanning ? undefined : startHint(!!project.context.trim(), folder, repos);
  const missing = blocker?.blocking ? blocker.why : '';
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
                : 'Add the project folder (optional)'}
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
            disabled={busy || scanning || !project.context.trim()}
            aria-describedby={missing ? 'start-hint' : undefined}
            onClick={() => void start()}
          >
            Hand it to Aiden <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <StartBlocker
        scanning={scanning}
        blocker={blocker}
        folder={folder}
        onChooseFolder={() => void scanProjectFolder(true)}
      />
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

/** Something the person should know before starting: a blocker, or a note that does not block. */
interface StartBlockerInfo {
  why: string;
  fix: string;
  chooseFolder: boolean;
  blocking: boolean;
}

/**
 * Say what is still needed before Aiden can start. Only the intent is required; a folder without a
 * Git repository is a note, because code can be connected later in the Guide.
 * Example: an empty box blocks; a folder with no repository explains and offers another folder.
 */
function startHint(
  hasIntent: boolean,
  folder: string | undefined,
  repos: number,
): StartBlockerInfo | undefined {
  if (!hasIntent)
    return {
      why: 'To start, describe what you are building.',
      fix: 'Type or paste your goal in the box above, or use Import a file. The project folder is optional.',
      chooseFolder: false,
      blocking: true,
    };
  if (folder && !repos)
    return {
      why: `No Git repository was found in ${folder}. You can start now and connect your code later in the Guide.`,
      fix: 'Code checks need a Git repository. Web, API, and manual checks do not.',
      chooseFolder: true,
      blocking: false,
    };
  return {
    why: 'After you start, Aiden plays back the requirements and asks how to check the work.',
    fix: folder
      ? 'Aiden will also check the code in this folder.'
      : 'No folder needed. You can connect your code, a web app, or an API in the setup chat.',
    chooseFolder: false,
    blocking: false,
  };
}

/**
 * Explain prominently why the start button is disabled and how to fix it.
 * Example: an empty intent shows the reason and the fix; a folder without Git offers another folder.
 */
function StartBlocker({
  scanning,
  blocker,
  folder,
  onChooseFolder,
}: {
  scanning: boolean;
  blocker: StartBlockerInfo | undefined;
  folder: string | undefined;
  onChooseFolder: () => void;
}): JSX.Element | null {
  if (scanning)
    return (
      <p className="start-blocker" role="status">
        <FolderKanban size={16} />
        <span>Finding repositories in the project folder. You can start when this finishes.</span>
      </p>
    );
  if (!blocker) return null;
  return (
    <div className={blocker.blocking ? 'start-blocker' : 'start-blocker start-note'}>
      {blocker.blocking ? <CircleAlert size={16} /> : <Info size={16} />}
      <div>
        <p id={blocker.blocking ? 'start-hint' : undefined}>{blocker.why}</p>
        <p className="start-blocker-fix">{blocker.fix}</p>
      </div>
      {blocker.chooseFolder && (
        <button className="start-blocker-action" onClick={onChooseFolder}>
          {folder ? 'Choose a different folder' : 'Browse for a folder'}
        </button>
      )}
    </div>
  );
}
