import { ArrowUpRight, Clock, RefreshCw } from 'lucide-react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type { Project, Report, RunManifest } from '../../../../packages/contracts/src/index';

interface RunHistoryProps {
  terminalRuns: RunManifest[];
  busy: boolean;
  action: (fn: () => Promise<void>) => Promise<void>;
  setReport: React.Dispatch<React.SetStateAction<Report | undefined>>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  project: Project;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setLog: React.Dispatch<React.SetStateAction<string[]>>;
  setActiveRun: React.Dispatch<React.SetStateAction<string>>;
}

/** Open completed reports or explicitly resume an interrupted run. */
export function RunHistory(props: RunHistoryProps): React.JSX.Element {
  const { terminalRuns, busy, action, setReport, call, project, setBusy, setLog, setActiveRun } =
    props;
  return (
    <section className="product-card history">
      <h3>
        <Clock size={16} /> Run history
      </h3>
      {terminalRuns.map((r) => (
        <div key={r.id}>
          <span>{new Date(r.createdAt).toLocaleString()}</span>
          <span className="muted">
            {r.kind === 'prepare' ? 'Requirements' : r.project.runtime.provider} · {r.status}
          </span>
          {r.status === 'completed' ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setReport(await call('result', { projectId: project.id, runId: r.id })),
                )
              }
            >
              Open <ArrowUpRight size={13} />
            </button>
          ) : (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setBusy(true);
                  setLog([]);
                  setActiveRun(r.id);
                  await call('resume', { projectId: project.id, runId: r.id });
                })
              }
            >
              Resume <RefreshCw size={13} />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
