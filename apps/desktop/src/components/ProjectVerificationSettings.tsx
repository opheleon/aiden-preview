import { type JSX, useEffect, useState } from 'react';

import type { DesktopBridge } from '../bridge';
import { verificationDraft, verificationUpdate } from '../renderer/verification-config';
import { VerificationFields } from './VerificationFields';

/** One saved configuration and explicit run action for all of a project's supported surfaces. */
export function ProjectVerificationSettings({
  projectId,
  api,
  disabled = false,
}: {
  projectId: string;
  api: DesktopBridge | undefined;
  disabled?: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(verificationDraft);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    void api
      ?.request('verificationSettings', { projectId })
      .then((settings) => {
        if (!closed) {
          setDraft(verificationDraft(settings));
          setReady(true);
        }
      })
      .catch(() => {
        if (!closed) setError('Could not load verification configuration.');
      });
    return () => {
      closed = true;
    };
  }, [api, projectId]);
  /** Save all surfaces together, then optionally run a fresh assessment and verification. */
  async function save(run = false): Promise<void> {
    if (!api) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const update = verificationUpdate(draft);
      const saved = await api.request('updateVerificationSettings', { projectId, ...update });
      setDraft(verificationDraft(saved));
      if (run) await api.request('look', { projectId, verifySurfaces: true });
      setMessage(
        run
          ? 'Code assessment started. Configured surface checks follow automatically; see Runs for progress.'
          : 'Verification configuration saved for this project.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save verification configuration.');
    } finally {
      setPending(false);
    }
  }
  const busy = disabled || pending || !ready;
  return (
    <section className="card settings-panel" aria-label="Project verification configuration">
      <h2>Verification configuration</h2>
      <VerificationFields api={api} value={draft} onChange={setDraft} disabled={busy} />
      <div className="button-row">
        <button disabled={busy} onClick={() => void save()}>
          Save verification settings
        </button>
        <button
          disabled={busy || !(draft.browser || draft.api || draft.phone)}
          onClick={() => void save(true)}
        >
          Run verification now
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
