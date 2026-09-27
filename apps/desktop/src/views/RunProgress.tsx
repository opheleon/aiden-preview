import { Square } from 'lucide-react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { WorkerMethod, WorkerParams } from '../../../../packages/contracts/src/api.js';

interface RunProgressProps {
  log: string[];
  step: number;
  activeRun: string;
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
}

/** Display bounded progress and let the user cancel the active run. */
export function RunProgress(props: RunProgressProps): React.JSX.Element {
  const { log, step, activeRun, action, call } = props;
  return (
    <section className="progress card">
      <div className="card-heading">
        <div className="spinner" />
        <div>
          <h2>
            {log.some((entry) => entry.toLowerCase().includes('estimat'))
              ? 'Estimating project scope'
              : step === 1
                ? 'Understanding your project'
                : 'Reading the evidence'}
          </h2>
          <p>Analysis runs locally through your selected provider.</p>
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
