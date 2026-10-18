import { type JSX, useEffect, useState } from 'react';

import type { VerificationSettings } from '../../../../packages/contracts/src/verification';
import type { Workspace } from '../hooks/useWorkspace';
import { useProjectGuide } from './ProjectGuide';

/** A compact read-only connection summary; edits open the shared chat without changing pages. */
export function ProjectConnections({ workspace }: { workspace: Workspace }): JSX.Element {
  const { open, revision } = useProjectGuide();
  const [result, setResult] = useState<{
    identity: string;
    settings: VerificationSettings | null;
    error: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const { call, project } = workspace;
  const identity = `${project.id}:${revision}:${retry}`;
  const settings = result?.identity === identity ? result.settings : null;
  const error = result?.identity === identity && result.error;
  useEffect(() => {
    let cancelled = false;
    void call('verificationSettings', { projectId: project.id }).then(
      (value) => {
        if (!cancelled) setResult({ identity, settings: value, error: false });
      },
      () => {
        if (!cancelled) setResult({ identity, settings: null, error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [call, project.id, identity]);
  const disabled = workspace.busy || project.lifecycle?.status === 'closed';
  return (
    <section className="brief-card project-connections" aria-label="Project connections">
      <div className="card-label-row">
        <h2 className="card-label">Project connections</h2>
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => open({ type: 'connections' })}
        >
          Manage
        </button>
      </div>
      {error ? (
        <p role="alert">
          Could not load connections.{' '}
          <button className="text-button" onClick={() => setRetry(retry + 1)}>
            Try again
          </button>
        </p>
      ) : !settings ? (
        <p>Loading connections…</p>
      ) : (
        <>
          <div className="project-connection-row">
            <span>Web app · {settings.url ? 'Connected' : 'Not connected'}</span>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => open({ type: 'verification', method: 'web' })}
            >
              {settings.url ? 'Edit web app' : 'Connect web app'}
            </button>
          </div>
          {settings.api && (
            <div className="project-connection-row">
              <span>API · Connected</span>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => open({ type: 'verification', method: 'api' })}
              >
                Edit API
              </button>
            </div>
          )}
          <p className="fine-print">
            {project.repositories.length
              ? `${project.repositories.length} code ${project.repositories.length === 1 ? 'repository' : 'repositories'} connected`
              : 'Code folder not connected'}
            {settings.manual ? ' · Manual checks enabled' : ''}
          </p>
        </>
      )}
    </section>
  );
}
