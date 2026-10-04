import { Globe } from 'lucide-react';
import { type JSX, useEffect, useState } from 'react';

import type { WorkerResult } from '../../../../packages/contracts/src/api';
import type { Project } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';

/** Show the worker's own message instead of Electron's IPC wrapper text. */
function plainError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** Show the project's most recent browser check and open its full report. */
function LatestCheck({
  project,
  api,
  latest,
  onError,
}: {
  project: Project;
  api?: DesktopBridge | undefined;
  latest: WorkerResult<'verification'>;
  onError: (message: string) => void;
}): JSX.Element {
  return (
    <div className="latest-check" aria-label="Last browser check">
      <p>
        {latest ? (
          <>
            <strong>
              Last browser check, {new Date(latest.result.generatedAt).toLocaleString()}.
            </strong>{' '}
            {latest.result.summary.line}
          </>
        ) : (
          'No browser check yet.'
        )}
      </p>
      <div className="button-row">
        {latest && (
          <button
            className="secondary"
            onClick={() =>
              void api
                ?.openVerificationReport({ projectId: project.id, runId: latest.result.runId })
                .catch((e: unknown) => onError(plainError(e, 'Could not open the report.')))
            }
          >
            Open full report
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Configure this project's deployed beta target for post-merge verification.
 */
export default function VerificationSettings({
  project,
  api,
  latest,
}: {
  project: Project;
  api?: DesktopBridge | undefined;
  latest: WorkerResult<'verification'>;
}): JSX.Element {
  const [url, setUrl] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (api)
      api.request('verificationSettings', { projectId: project.id }).then(
        (settings) => {
          if (cancelled) return;
          setCurrent(settings.url);
          setUrl(settings.url ?? '');
          setLoaded(true);
        },
        (e: unknown) => {
          if (!cancelled) setError(plainError(e, 'Could not load the app URL.'));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [project.id, api]);
  /** Save or clear the URL, keeping the typed value when the worker rejects it. */
  async function save(next: string | null) {
    if (!api) return;
    setSaving(true);
    setError('');
    try {
      const settings = await api.request('updateVerificationSettings', {
        projectId: project.id,
        url: next,
      });
      setCurrent(settings.url);
      setUrl(settings.url ?? '');
    } catch (e) {
      setError(plainError(e, 'Could not save the app URL.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card settings-panel app-url-panel" aria-label="App URL settings">
      <div className="card-heading">
        <div className="section-icon">
          <Globe size={19} />
        </div>
        <div>
          <h2>Beta app URL for {project.name || 'this project'}</h2>
          <p>
            Set the deployed beta URL for post-merge verification. Local tests belong to your coding
            agent.
          </p>
        </div>
      </div>
      <label>
        App URL
        <input
          type="url"
          aria-label="App URL"
          placeholder="https://beta.example.com"
          disabled={!loaded}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <p className="fine-print">
        Each project keeps its own URL. Use the deployed beta site you control. Aiden only opens
        this address in a browser and never runs repository code. Saving a non-local address is what
        allows Aiden to open it. Aiden will not delete data, send email, or make payments while
        testing.
      </p>
      <div className="button-row">
        <button
          className="primary"
          disabled={!loaded || saving || !url.trim() || url.trim() === current}
          onClick={() => void save(url.trim())}
        >
          {saving ? 'Saving…' : 'Save URL'}
        </button>
        {current && (
          <button disabled={saving} onClick={() => void save(null)}>
            Clear
          </button>
        )}
      </div>
      {loaded && <p role="status">{current ? `Saved: ${current}` : 'No app URL saved.'}</p>}
      {current && (
        <p className="fine-print">
          Scheduled beta checks test the requirements at this URL after merge. Only for apps with a
          sign-in: before starting Aiden, set AIDEN_VERIFY_USERNAME and AIDEN_VERIFY_PASSWORD to a
          test account. Aiden types them into the sign-in form and never shows them in reports.
        </p>
      )}
      {current && <LatestCheck project={project} api={api} latest={latest} onError={setError} />}
      {error && (
        <p role="alert" className="settings-save-error">
          {error}
        </p>
      )}
    </section>
  );
}
