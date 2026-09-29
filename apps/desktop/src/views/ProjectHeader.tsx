import { Clock, Download, Globe, RefreshCw, Settings2 } from 'lucide-react';
import React, { useState } from 'react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type {
  Baseline,
  EstimationSnapshot,
  Project,
  Report,
} from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import VerificationSettings from '../components/VerificationSettings';

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
  verify: () => Promise<void>;
  verification: WorkerResult<'verification'>;
}

/** Present the selected project, its assessment actions, and its own app URL panel. */
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
    verify,
    verification,
  } = props;
  const [appUrlOpen, setAppUrlOpen] = useState(false);
  const overview = step === 3 && !!baseline;
  return (
    <>
      <div className={step === 3 ? 'product-header' : 'title-row'}>
        <ProjectTitle step={step} project={project} report={report} />
        {overview && (
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
            <button
              className="secondary"
              aria-expanded={appUrlOpen}
              onClick={() => setAppUrlOpen(!appUrlOpen)}
            >
              <Globe size={15} /> App URL
            </button>
            <RefreshButton busy={busy} onRun={analyze} />
          </div>
        )}
      </div>
      {overview && appUrlOpen && (
        <VerificationSettings
          key={project.id}
          project={project}
          api={api}
          latest={verification}
          busy={busy}
          onCheck={verify}
        />
      )}
    </>
  );
}

/** Assess the code, then check the saved app URL in a browser; held while any run is active. */
function RefreshButton({
  busy,
  onRun,
}: {
  busy: boolean;
  onRun: () => Promise<void>;
}): React.JSX.Element {
  const [starting, setStarting] = useState(false);
  return (
    <button
      className="primary"
      disabled={busy || starting}
      onClick={() => {
        setStarting(true);
        void onRun().finally(() => setStarting(false));
      }}
    >
      <RefreshCw size={15} /> {busy ? 'Refreshing…' : 'Refresh status'}
    </button>
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
