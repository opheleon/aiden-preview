import { MoreHorizontal } from 'lucide-react';
import type { JSX } from 'react';

import type { Project } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';
import { outcomeReady } from './ProjectOutcome';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
const api = window.aiden;

/** A decision that needs a confirmation dialog, for one project. */
export type OutcomeRequest = { projectId: string; mode: 'accept' | 'close' };

/** One menu entry; a null entry draws a divider. */
type Item = { label: string; run: () => void; disabled?: boolean; danger?: boolean } | null;

/**
 * Every action for one project, grouped like a desktop context menu: settings and exports, then
 * the outcome decision, then closing in red. Actions that need the project's loaded report work
 * on the open project; choosing another project's action opens that project first.
 */
function projectItems(
  workspace: Workspace,
  project: Project,
  onOutcome: (request: OutcomeRequest) => void,
): Item[] {
  const current = project.id === workspace.project.id;
  const closed = project.lifecycle?.status === 'closed';
  const report = current ? workspace.report : undefined;
  /** Open this project if needed, then act on it. */
  const open = (action: () => void) => () =>
    void (current ? Promise.resolve() : workspace.load(project.id)).then(action);
  /** Save the open project's latest report in the chosen format. */
  const exportAs = (format: 'markdown' | 'json') => () =>
    void workspace.action(async () => {
      if (report && (await api?.saveExport({ projectId: project.id, runId: report.id, format })))
        workspace.setNotice(`${format === 'json' ? 'JSON' : 'Markdown'} report exported.`);
    });
  /** Resume monitoring with the existing settings, keeping every saved decision. */
  const reopen = () =>
    void workspace.action(async () => {
      const saved = await workspace.call('reopenProject', { projectId: project.id });
      workspace.setProject((p) => (p.id === saved.id ? saved : p));
      workspace.setProjects((all) => all.map((p) => (p.id === saved.id ? saved : p)));
    });
  const accept =
    current && !closed && outcomeReady(workspace)
      ? {
          label: project.lifecycle?.acceptanceCurrent ? 'Update acceptance' : 'Accept outcome',
          run: () => onOutcome({ projectId: project.id, mode: 'accept' }),
          disabled: workspace.busy || !workspace.baseline || !project.lifecycle,
        }
      : null;
  return [
    {
      label: 'Project settings',
      run: open(() => {
        workspace.setSettingsTab('project');
        workspace.setArea('settings');
      }),
    },
    { label: 'Export Markdown', run: exportAs('markdown'), disabled: !report },
    { label: 'Export JSON', run: exportAs('json'), disabled: !report },
    null,
    ...(accept ? [accept] : []),
    ...(closed ? [{ label: 'Reopen project', run: reopen }, null] : []),
    ...(closed
      ? []
      : [
          null,
          {
            label: 'Close project',
            danger: true,
            disabled: current && workspace.busy,
            run: open(() => onOutcome({ projectId: project.id, mode: 'close' })),
          },
        ]),
  ];
}

/** Drop dividers at either end and repeated dividers, so groups never leave empty lines. */
function tidy(items: Item[]): Item[] {
  const kept = items.filter((item, index) => item !== null || (index > 0 && items[index - 1]));
  while (kept.length && kept.at(-1) === null) kept.pop();
  return kept;
}

/**
 * The "…" button on a project row and its menu. The menu is drawn above the whole window, below
 * the button, so a scrolling sidebar never clips or offsets it; Escape, a click elsewhere, or
 * choosing an item closes it, and arrow keys move between the actions.
 */
export function ProjectMenu({
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
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="project-row-trigger" aria-label={`Actions for ${name}`}>
        <MoreHorizontal size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[210px]">
        {tidy(projectItems(workspace, project, onOutcome)).map((item, index) =>
          item ? (
            // Real buttons keep the native disabled state that tests and assistive tech read.
            <DropdownMenuItem
              key={item.label}
              asChild
              disabled={!!item.disabled}
              variant={item.danger ? 'destructive' : 'default'}
              onSelect={item.run}
            >
              <button type="button" disabled={!!item.disabled}>
                {item.label}
              </button>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSeparator key={`divider-${index}`} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
