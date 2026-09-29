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

/** Show the project's most recent browser check, open its full report, or check again now. */
function LatestCheck({
  project,
  api,
  latest,
  busy,
  onCheck,
  onError,
}: {
  project: Project;
  api?: DesktopBridge | undefined;
  latest: WorkerResult<'verification'>;
  busy: boolean;
  onCheck: () => Promise<void>;
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
        <button className="secondary" disabled={busy} onClick={() => void onCheck()}>
          Check now
        </button>
      </div>
    </div>
  );
}

/** Load and edit the URL Aiden opens when it checks this saved project's approved requirements. */
export default function VerificationSettings({
  project,
  api,
  latest,
  busy,
  onCheck,
}: {
  project: Project;
  api?: DesktopBridge | undefined;
  latest: WorkerResult<'verification'>;
  busy: boolean;
  onCheck: () => Promise<void>;
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
          <h2>App URL for {project.name || 'this project'}</h2>
          <p>Where Aiden opens this project to check its approved requirements.</p>
        </div>
      </div>
      <label>
        App URL
        <input
          type="url"
          aria-label="App URL"
          placeholder="http://localhost:3000"
          disabled={!loaded}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <p className="fine-print">
        Each project keeps its own URL. Use a localhost address or a beta site you control, and
        start the app yourself first. Aiden only opens this address in a browser and never runs
        repository code. Saving a non-local address is what allows Aiden to open it. Aiden will not
        delete data, send email, or make payments while testing.
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
          Each status refresh also tests every approved requirement at this URL, after the code
          assessment. Only for apps with a sign-in: before starting Aiden, set AIDEN_VERIFY_USERNAME
          and AIDEN_VERIFY_PASSWORD to a test account. Aiden types them into the sign-in form and
          never shows them in reports.
        </p>
      )}
      {current && (
        <LatestCheck
          project={project}
          api={api}
          latest={latest}
          busy={busy}
          onCheck={onCheck}
          onError={setError}
        />
      )}
      {error && (
        <p role="alert" className="settings-save-error">
          {error}
        </p>
      )}
    </section>
  );
}
