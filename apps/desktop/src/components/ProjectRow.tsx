import { MoreHorizontal } from 'lucide-react';
import { type JSX, useRef, useState } from 'react';

import type { Project } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';

/**
 * One project in the sidebar: a single line whose name fades out at the edge, and a "…" menu for
 * project actions that appears on hover or focus. Choosing an action opens the project first, so
 * the action always applies to the project the person picked.
 */
export function ProjectRow({
  workspace,
  project,
  name,
  onClose,
}: {
  workspace: Workspace;
  project: Project;
  name: string;
  /** Ask to close this project; the caller shows the confirmation. */
  onClose: (projectId: string) => void;
}): JSX.Element {
  const { load, area, setArea, setSettingsTab } = workspace;
  const current = project.id === workspace.project.id;
  const closed = project.lifecycle?.status === 'closed';
  const menu = useRef<HTMLDetailsElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  /** Close the menu, open this project, then run the chosen action. */
  const choose = (action: () => void) => () => {
    if (menu.current) menu.current.open = false;
    void (current ? Promise.resolve() : load(project.id)).then(action);
  };
  return (
    <div className={current && area === 'projects' ? 'project-row selected' : 'project-row'}>
      <button
        className="project-link"
        aria-current={current ? 'page' : undefined}
        onClick={() => void load(project.id)}
        title={name}
      >
        <span className="project-dot" aria-hidden="true" />
        <span className="project-name">{name}</span>
      </button>
      <details
        className="overflow-menu project-row-menu"
        ref={menu}
        onToggle={(event) => {
          const summary = event.currentTarget.querySelector('summary');
          const box = summary?.getBoundingClientRect();
          setPosition(event.currentTarget.open && box ? { top: box.bottom, left: box.left } : null);
        }}
      >
        <summary aria-label={`Actions for ${name}`}>
          <MoreHorizontal size={15} />
        </summary>
        {position && (
          <div role="menu" style={position}>
            <button
              role="menuitem"
              onClick={choose(() => {
                setSettingsTab('project');
                setArea('settings');
              })}
            >
              Project settings
            </button>
            {!closed && (
              <button role="menuitem" onClick={choose(() => onClose(project.id))}>
                Close project
              </button>
            )}
          </div>
        )}
      </details>
    </div>
  );
}
