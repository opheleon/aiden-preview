import { type JSX, type ReactNode, useEffect, useState } from 'react';

import type { DeviceRun } from '../../../../packages/contracts/src/device-verification';
import type { Project } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import { ProjectVerificationSettings } from '../components/ProjectVerificationSettings';
import { phoneVerificationVisible } from '../renderer/verification-features';

/** Project workflow: assess repository code, then check the same requirements on the installed build. */
export function DeviceTesting({
  api,
  project,
  busy,
  schedule,
}: {
  api: DesktopBridge | undefined;
  project: Project;
  busy: boolean;
  schedule?: ReactNode;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [runs, setRuns] = useState<DeviceRun[]>([]);
  useEffect(() => {
    if (!phoneVerificationVisible()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    /** Poll sequentially so slow worker responses never accumulate overlapping requests. */
    async function poll(): Promise<void> {
      try {
        const next = await api?.request('deviceRuns');
        if (!stopped && next) setRuns(next.filter((run) => run.source?.projectId === project.id));
      } catch {
        if (!stopped) setError('Could not refresh device tests.');
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 2000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, project.id]);
  /** Keep setup and run errors visible while allowing the user to correct inputs. */
  async function action(fn: () => Promise<void>): Promise<void> {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Device operation failed.');
    } finally {
      setPending(false);
    }
  }
  const disabled = busy || pending || runs.some((run) => run.status === 'running');
  return (
    <div className="content device-testing">
      <h1>Verification</h1>
      <p>
        Aiden assesses {project.name}’s repository code, then checks its requirements and edge cases
        on the configured surfaces. Code findings and observed app behavior remain separate
        evidence.
      </p>
      <ProjectVerificationSettings projectId={project.id} api={api} disabled={disabled} />
      {schedule}
      <p>
        Uses this project’s model and authentication settings. Browser and API evidence is available
        in Runs. {phoneVerificationVisible() && 'Phone evidence is below.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {phoneVerificationVisible() && (
        <section aria-label="Device test history">
          <h2>Device tests</h2>
          {runs.length === 0 && <p>No device tests yet.</p>}
          {runs.map((run) => (
            <article className="card" key={run.id}>
              <h3>
                {run.name} · {run.buildLabel}
              </h3>
              <p>{run.message}</p>
              <p>
                Code assessment: {run.source?.reportId}. Baseline: {run.source?.baselineId}. Build
                label is supplied by the tester; its match to the assessed commits is unverified.
              </p>
              {run.status === 'running' && (
                <button
                  onClick={() =>
                    void action(async () => {
                      await api?.request('deviceCancel', { runId: run.id });
                      setMessage('Stopping device test.');
                    })
                  }
                >
                  Stop test
                </button>
              )}
              <ul>
                {run.criteria.map((c, i) => (
                  <li key={i}>
                    <strong>
                      {run.source?.checks[i]?.requirementId}
                      {run.source?.checks[i]?.edgeCaseId
                        ? ` / ${run.source.checks[i].edgeCaseId}`
                        : ''}
                    </strong>
                    : {c.criterion}
                    <p>
                      Code: {run.source?.checks[i]?.codeStatus}. Installed app:{' '}
                      <strong>{c.verdict}</strong>.
                    </p>
                    <p>{c.explanation}</p>
                  </li>
                ))}
              </ul>
              <button
                disabled={!api}
                onClick={() =>
                  void action(async () => {
                    await api?.openDeviceReport(run.id);
                  })
                }
              >
                Open evidence report
              </button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
