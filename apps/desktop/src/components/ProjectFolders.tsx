import { FolderKanban, Plus, X } from 'lucide-react';
import type { JSX } from 'react';

import type { Project } from '../../../../packages/contracts/src/index';
import { projectFolders } from '../hooks/project-folders';

/** The last part of a folder path, as people name the folder. */
export function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

/**
 * The code folders connected to a project, each with its repository count and a remove button,
 * plus Add a folder. A project can span several unrelated folders, such as a web app and an API.
 */
export function ProjectFolders({
  project,
  busy,
  scanning,
  onAdd,
  onRemove,
}: {
  project: Project;
  busy: boolean;
  scanning: boolean;
  onAdd: () => void;
  onRemove: (folder: string) => void;
}): JSX.Element {
  const folders = projectFolders(project);
  /** Repositories found in one folder, matched by whole path segments. */
  const count = (folder: string): number =>
    project.repositories.filter((repo) => {
      const separator = folder.includes('\\') ? '\\' : '/';
      return repo.path === folder || repo.path.startsWith(`${folder}${separator}`);
    }).length;
  return (
    <div className="project-folders">
      {folders.length > 0 && (
        <ul className="project-folder-list" aria-label="Code folders">
          {folders.map((folder) => (
            <li key={folder} className="project-folder">
              <FolderKanban size={16} aria-hidden="true" />
              <span className="project-folder-text">
                <strong>{folderName(folder)}</strong>
                <small title={folder}>
                  {count(folder)} {count(folder) === 1 ? 'repository' : 'repositories'} · {folder}
                </small>
              </span>
              <button
                className="text-button"
                aria-label={`Remove ${folderName(folder)}`}
                disabled={busy || scanning}
                onClick={() => onRemove(folder)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="secondary" disabled={busy || scanning} onClick={onAdd}>
        <Plus size={15} />
        {scanning
          ? 'Finding repositories…'
          : folders.length
            ? 'Add another folder'
            : 'Add a folder'}
      </button>
    </div>
  );
}
