import {
  AlertTriangle,
  Check,
  FolderGit2,
  FolderKanban,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import React from 'react';

import type { Project } from '../../../../packages/contracts/src/index';

interface RepositorySetupProps {
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  busy: boolean;
  scanning: boolean;
  scanProjectFolder: (choose?: boolean) => Promise<void>;
}

/** Review discovered repositories and branch notes before preparing requirements. */
export function RepositorySetup(props: RepositorySetupProps): React.JSX.Element {
  const { project, setProject, busy, scanning, scanProjectFolder } = props;
  return (
    <section className="card">
      <div className="card-heading">
        <div className="section-icon">
          <FolderGit2 size={19} />
        </div>
        <div>
          <h2>Project workspace</h2>
          <p>Choose one folder. Aiden finds the Git repositories inside it.</p>
        </div>
      </div>
      <label>
        Project name
        <input
          placeholder="e.g. Customer portal"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
        />
      </label>
      <div className="label-row">
        <span>Project folder</span>
        <span>One folder for this project</span>
      </div>
      {project.rootPath && (
        <div className="repo project-root" data-testid="project-root">
          <div className="repo-heading">
            <FolderKanban size={19} />
            <div>
              <strong>{project.rootPath.split('/').at(-1) || project.rootPath}</strong>
              <small title={project.rootPath}>{project.rootPath}</small>
            </div>
          </div>
        </div>
      )}
      {!project.rootPath && project.repositories.length > 0 && (
        <p className="inline-note">
          This saved project uses individually selected repositories. Choose their parent folder to
          use one project folder, or continue with the saved selection.
        </p>
      )}
      <button
        className="add-repo"
        disabled={busy || scanning}
        onClick={() => void scanProjectFolder(true)}
      >
        <FolderKanban size={17} />
        {scanning
          ? 'Finding repositories…'
          : project.rootPath
            ? 'Change project folder'
            : 'Choose project folder'}
      </button>
      {(project.rootPath || project.repositories.length > 0) && (
        <>
          <div className="label-row">
            <span>Repositories included · {project.repositories.length}</span>
            {project.rootPath && (
              <button
                className="text-button"
                disabled={busy || scanning}
                onClick={() => void scanProjectFolder()}
              >
                <RefreshCw size={13} /> Rescan folder
              </button>
            )}
          </div>
          <p className="inline-note">
            All repositories listed below are assessed as one project. Branches and history stay
            separate. Rescan to discover added or moved repositories.
          </p>
        </>
      )}
      {project.discoveryWarnings?.map((warning) => (
        <div className="callout warning" role="status" key={warning}>
          <AlertTriangle size={16} />
          <div>{warning}</div>
        </div>
      ))}
      {project.repositories.map((r, i) => (
        <div className="repo" key={r.id} data-testid="discovered-repository">
          <div className="repo-heading">
            <FolderGit2 size={17} />
            <div>
              <strong>{r.path.split('/').at(-1)}</strong>
              <small title={r.path}>
                {project.rootPath
                  ? r.path === project.rootPath
                    ? 'Project root'
                    : r.path.slice(project.rootPath === '/' ? 1 : project.rootPath.length + 1)
                  : r.path}
              </small>
            </div>
            <Check size={15} aria-label="Included" />
          </div>
          <input
            aria-label={`Branch notes for ${r.id}`}
            placeholder="Optional: main is production, develop is integration…"
            value={r.notes}
            onChange={(e) =>
              setProject({
                ...project,
                repositories: project.repositories.map((x, j) =>
                  j === i ? { ...x, notes: e.target.value } : x,
                ),
              })
            }
          />
        </div>
      ))}
      <div className="inline-note">
        <ShieldCheck size={16} />
        <span>
          Clean branches sync automatically. Local changes are preserved and excluded from analysis.
        </span>
      </div>
    </section>
  );
}
