import { Clock, Download, RefreshCw, Settings2 } from 'lucide-react';
import React from 'react';

import type {
  Baseline,
  EstimationSnapshot,
  Project,
  Report,
} from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';

interface ProjectHeaderProps {
  step: number;
  project: Project;
  report: Report | undefined;
  baseline: Baseline | undefined;
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  api: DesktopBridge | undefined;
  estimation: EstimationSnapshot | undefined;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  setArea: React.Dispatch<React.SetStateAction<'projects' | 'drafts' | 'settings'>>;
  setSettingsTab: React.Dispatch<
    React.SetStateAction<'model' | 'integrations' | 'schedule' | 'preferences' | 'desktop'>
  >;
  analyze: () => Promise<void>;
}

/** Present the selected project and its available assessment actions. */
export function ProjectHeader(props: ProjectHeaderProps): React.JSX.Element {
  const {
    step,
    project,
    report,
    baseline,
    busy,
    action,
    api,
    estimation,
    setNotice,
    setArea,
    setSettingsTab,
    analyze,
  } = props;
  return (
    <div className={step === 3 ? 'product-header' : 'title-row'}>
      <ProjectTitle step={step} project={project} report={report} />
      {step === 3 && baseline && !busy && (
        <div className="product-actions">
          {report && (
            <>
              <button
                className="secondary"
                onClick={() =>
                  void action(async () => {
                    if (
                      await api?.saveExport({
                        projectId: project.id,
                        runId: report.id,
                        format: 'markdown',
                        includeEstimates: estimation?.reportId === report.id,
                      })
                    )
                      setNotice('Markdown report exported.');
                  })
                }
              >
                <Download size={14} /> Markdown
              </button>
              <button
                className="secondary"
                onClick={() =>
                  void action(async () => {
                    if (
                      await api?.saveExport({
                        projectId: project.id,
                        runId: report.id,
                        format: 'json',
                      })
                    )
                      setNotice('JSON report exported.');
                  })
                }
              >
                JSON
              </button>
            </>
          )}
          <button
            className="secondary"
            onClick={() => {
              setArea('settings');
              setSettingsTab('model');
            }}
          >
            <Settings2 size={15} /> {project.runtime.provider === 'claude' ? 'Claude' : 'Codex'} ·{' '}
            {project.runtime.auth === 'subscription' ? 'Subscription' : 'API key'} ·{' '}
            {project.runtime.model || 'Provider default'}
          </button>
          <button
            className="secondary"
            onClick={() => {
              setArea('settings');
              setSettingsTab('schedule');
            }}
          >
            <Clock size={15} /> Schedule
          </button>
          <button className="primary" onClick={() => void analyze()}>
            <RefreshCw size={15} /> Refresh status
          </button>
        </div>
      )}
    </div>
  );
}

/** Describe the current setup stage or the freshness of the accepted project report. */
function ProjectTitle({
  step,
  project,
  report,
}: Pick<ProjectHeaderProps, 'step' | 'project' | 'report'>): React.JSX.Element {
  return (
    <div>
      <h1>
        {step === 0 ? (
          <>
            What <span className="serif">project</span> should Aiden track?
          </>
        ) : step === 1 ? (
          <>
            Define the <span className="serif">intent.</span>
          </>
        ) : step === 2 ? (
          'Review requirements'
        ) : (
          project.name || 'Project overview'
        )}
      </h1>
      <p className={step === 3 ? 'project-refresh-date' : 'subtitle'}>
        {step === 0
          ? 'Connect your code, describe what you’re building, and review the requirements before checking the implementation.'
          : step === 1
            ? 'Give Aiden the intent behind the implementation.'
            : step === 2
              ? 'Review these requirements once. Every report will assess this baseline.'
              : report
                ? `Last status refresh ${new Date(report.generatedAt).toLocaleString()}`
                : 'Ready to track progress'}
      </p>
    </div>
  );
}
