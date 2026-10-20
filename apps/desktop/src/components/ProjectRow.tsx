import type { JSX } from 'react';

import type { Project } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';
import { type OutcomeRequest, ProjectMenu } from './ProjectMenu';

/**
 * One project in the sidebar: a single line whose name fades out at the edge, and a "…" menu with
 * every project action that appears on hover or focus.
 */
export function ProjectRow({
  workspace,
  project,
  name,
  onOutcome,
}: {
  workspace: Workspace;
  project: Project;
  name: string;
  onOutcome: (request: OutcomeRequest) => void;
}): JSX.Element {
  const current = project.id === workspace.project.id;
  return (
    <div
      className={current && workspace.area === 'projects' ? 'project-row selected' : 'project-row'}
    >
      <button
        className="project-link"
        aria-current={current ? 'page' : undefined}
        onClick={() => void workspace.load(project.id)}
        title={name}
      >
        <span className="project-dot" aria-hidden="true" />
        <span className="project-name">{name}</span>
      </button>
      <ProjectMenu workspace={workspace} project={project} name={name} onOutcome={onOutcome} />
    </div>
  );
}
