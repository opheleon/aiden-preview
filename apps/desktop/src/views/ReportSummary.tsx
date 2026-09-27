import { Download, ShieldCheck } from 'lucide-react';

import type { EstimationSnapshot, Project, Report } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';

interface ReportSummaryProps {
  report: Report;
  action: (fn: () => Promise<void>) => Promise<void>;
  api: DesktopBridge | undefined;
  project: Project;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  estimation: EstimationSnapshot | undefined;
}

/** Summarize the accepted report and its evidence limitations. */
export function ReportSummary(props: ReportSummaryProps): React.JSX.Element {
  const { report, action, api, project, setNotice, estimation } = props;
  return (
    <div className="report-top legacy-report-panel">
      <span className="report-label">
        <ShieldCheck size={15} /> EVIDENCE REFERENCES CHECKED
      </span>
      <span>{new Date(report.generatedAt).toLocaleString()}</span>
      <div>
        <button
          className="secondary"
          onClick={() =>
            void action(async () => {
              if (
                await api?.saveExport({
                  projectId: project.id,
                  runId: report.id,
                  format: 'markdown',
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
        {estimation?.reportId === report.id && (
          <button
            className="secondary"
            onClick={() =>
              void action(async () => {
                if (
                  await api?.saveExport({
                    projectId: project.id,
                    runId: report.id,
                    format: 'markdown',
                    includeEstimates: true,
                  })
                )
                  setNotice('Report and estimates exported.');
              })
            }
          >
            <Download size={14} /> Report + estimates
          </button>
        )}
      </div>
    </div>
  );
}
