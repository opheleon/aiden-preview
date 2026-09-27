import { ExternalLink, FileText, Layers, MessageCircle, Plus, Settings2 } from 'lucide-react';
import React from 'react';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../../packages/contracts/src/api.js';
import type {
  Baseline,
  EstimationSnapshot,
  Product,
  Project,
  Report,
  RunManifest,
} from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';

interface WorkspaceSidebarProps {
  busy: boolean;
  setArea: React.Dispatch<React.SetStateAction<'projects' | 'drafts' | 'settings'>>;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  newProject: () => Project;
  setBaseline: React.Dispatch<React.SetStateAction<Baseline | undefined>>;
  setProduct: React.Dispatch<React.SetStateAction<Product | undefined>>;
  setReport: React.Dispatch<React.SetStateAction<Report | undefined>>;
  setEstimation: React.Dispatch<React.SetStateAction<EstimationSnapshot | undefined>>;
  setContextConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  setHistoryDraft: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      sourceId: string;
      sourceLabel: string;
      historyTool: string;
      sourceArgument: string;
    }>
  >;
  setRuns: React.Dispatch<React.SetStateAction<RunManifest[]>>;
  setStep: React.Dispatch<React.SetStateAction<number>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setReviewRun: React.Dispatch<React.SetStateAction<string>>;
  setShowGoalStarter: React.Dispatch<React.SetStateAction<boolean>>;
  projects: Project[];
  project: Project;
  load: (id: string) => Promise<void>;
  reviewRun: string;
  area: 'projects' | 'drafts' | 'settings';
  runs: RunManifest[];
  terminalRuns: RunManifest[];
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  api: DesktopBridge | undefined;
  slackInviteUrl: 'https://join.slack.com/t/aidenbyopheleon/shared_invite/zt-4apsg5d7p-FDO9ae0imxj~KgauP8lpsw';
}

/** Navigate saved projects, drafts, and recent workflow runs. */
export function WorkspaceSidebar(props: WorkspaceSidebarProps): React.JSX.Element {
  const {
    busy,
    setArea,
    setProject,
    newProject,
    setBaseline,
    setProduct,
    setReport,
    setEstimation,
    setContextConnectionIds,
    setHistoryDraft,
    setRuns,
    setStep,
    setError,
    setReviewRun,
    setShowGoalStarter,
    projects,
    project,
    load,
    reviewRun,
    area,
    runs,
    terminalRuns,
    action,
    call,
    api,
    slackInviteUrl,
  } = props;
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <div className="workspace-label">Projects</div>
        <button
          className="sidebar-add"
          aria-label="Create project"
          title="New project"
          disabled={busy}
          onClick={() => {
            setArea('projects');
            setProject(newProject());
            setBaseline(undefined);
            setProduct(undefined);
            setReport(undefined);
            setEstimation(undefined);
            setContextConnectionIds([]);
            setHistoryDraft({
              connectionId: '',
              sourceId: '',
              sourceLabel: '',
              historyTool: '',
              sourceArgument: 'team',
            });
            setRuns([]);
            setStep(0);
            setError('');
            setReviewRun('');
            setShowGoalStarter(true);
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      <nav className="project-nav">
        {projects.map((p) => (
          <button
            key={p.id}
            disabled={busy}
            className={p.id === project.id ? 'selected' : ''}
            aria-current={p.id === project.id ? 'page' : undefined}
            onClick={() => void load(p.id)}
          >
            <span className="project-dot" aria-hidden="true" />
            <span>{p.name}</span>
          </button>
        ))}
      </nav>
      {reviewRun && (
        <section className="draft-section" aria-label="Draft chats">
          <div className="workspace-label">Draft chats</div>
          <button
            className={area === 'drafts' ? 'draft-row selected' : 'draft-row'}
            onClick={() => setArea('drafts')}
          >
            <FileText size={13} />
            <span>{project.name || 'Project draft'}</span>
          </button>
        </section>
      )}
      <div className="workspace-nav">
        <div className="workspace-label">Workspace</div>
        {project.name && (
          <button
            className={area === 'projects' ? 'workspace-overview selected' : 'workspace-overview'}
            onClick={() => setArea('projects')}
          >
            <Layers size={14} />
            <span>{reviewRun ? 'Prepare project' : 'Overview'}</span>
          </button>
        )}
        {runs.length > 0 && (
          <details className="workflow-history">
            <summary>Workflow history</summary>
            {terminalRuns.slice(0, 6).map((run) => (
              <button
                key={run.id}
                onClick={() =>
                  void action(async () => {
                    if (run.status !== 'completed') return;
                    setReport(await call('result', { projectId: project.id, runId: run.id }));
                    setArea('projects');
                    setStep(3);
                  })
                }
              >
                <span className={`run-dot ${run.status}`} />
                <span>{run.kind === 'report' ? 'Code assessment' : run.kind}</span>
              </button>
            ))}
          </details>
        )}
      </div>
      <div className="sidebar-bottom">
        <button
          className={area === 'settings' ? 'sidebar-section selected' : 'sidebar-section'}
          onClick={() => setArea('settings')}
        >
          <Settings2 size={17} />
          <span>Settings</span>
        </button>
        <button
          className="sidebar-section"
          title="Join Aiden by Opheleon on Slack (opens in your browser)"
          onClick={() =>
            void action(async () => {
              await api?.openExternal(slackInviteUrl);
            })
          }
        >
          <MessageCircle size={17} />
          <span>Contact us</span>
          <ExternalLink size={13} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
