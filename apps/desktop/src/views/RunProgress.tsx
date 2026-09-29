import { Square } from 'lucide-react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';
import type { RunManifest } from '../../../../packages/contracts/src/index';

interface RunProgressProps {
  log: string[];
  step: number;
  activeRun: string;
  runs: RunManifest[];
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
}

const headings: Record<RunManifest['kind'], { title: string; detail: string }> = {
  verify: {
    title: 'Checking the app in a browser',
    detail: 'Aiden tests each approved requirement like a user would and records every attempt.',
  },
  estimate: {
    title: 'Estimating remaining work',
    detail: 'Sizing the changes left for each requirement through your selected provider.',
  },
  report: {
    title: 'Assessing the code',
    detail: 'Reading your repositories locally through your selected provider.',
  },
  prepare: {
    title: 'Understanding your project',
    detail: 'Analysis runs locally through your selected provider.',
  },
};

/** Name what the followed run is doing, falling back to its log before its manifest has loaded. */
function heading(kind: RunManifest['kind'] | undefined, log: string[], step: number) {
  if (kind) return headings[kind];
  if (log.some((entry) => entry.toLowerCase().includes('estimat'))) return headings.estimate;
  return step === 1
    ? headings.prepare
    : { title: 'Reading the evidence', detail: headings.prepare.detail };
}

/** Display bounded progress and let the user cancel the active run. */
export function RunProgress(props: RunProgressProps): React.JSX.Element {
  const { log, step, activeRun, runs, action, call } = props;
  const { title, detail } = heading(runs.find((run) => run.id === activeRun)?.kind, log, step);
  return (
    <section className="progress card">
      <div className="card-heading">
        <div className="spinner" />
        <div>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
        <button
          className="secondary"
          disabled={!activeRun}
          onClick={() =>
            void action(async () => {
              await call('cancel', { runId: activeRun });
            })
          }
        >
          <Square size={12} /> Stop
        </button>
      </div>
      <div className="log" aria-live="polite">
        {log.slice(-5).map((l, i) => (
          <div key={i}>
            <span />
            {l}
          </div>
        ))}
      </div>
    </section>
  );
}
