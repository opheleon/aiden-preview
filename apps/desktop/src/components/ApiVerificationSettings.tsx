import { type JSX, useEffect, useState } from 'react';

import type { DesktopBridge } from '../bridge';

/** Configure a separate API target without exposing test credentials to the renderer. */
export function ApiVerificationSettings({
  projectId,
  api,
}: {
  projectId: string;
  api: DesktopBridge | undefined;
}): JSX.Element {
  const [url, setUrl] = useState('');
  const [writes, setWrites] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    api
      ?.request('verificationSettings', { projectId })
      .then((settings) => {
        if (cancelled) return;
        setUrl(settings.api?.url ?? '');
        setWrites(settings.api?.allowMutations ?? false);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setMessage('Could not load API settings.');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, api]);
  /** Save an explicitly selected API; blank removes the target and its write permission together. */
  async function save(clear = false): Promise<void> {
    setBusy(true);
    try {
      await api?.request('updateVerificationSettings', {
        projectId,
        api: clear ? null : { url: url.trim(), allowMutations: writes },
      });
      if (clear) {
        setUrl('');
        setWrites(false);
      }
      setMessage(
        clear ? 'API target cleared.' : 'API settings saved for scheduled post-merge beta checks.',
      );
    } catch {
      setMessage('Could not save. Enter an HTTP or HTTPS API base URL.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card settings-panel" aria-label="API verification settings">
      <h2>Beta API verification</h2>
      <p>
        Aiden tests beta endpoints after merge and records the requests and assertions for Watch.
      </p>
      <label>
        API base URL
        <input
          type="url"
          value={url}
          disabled={!ready || busy}
          placeholder="https://beta.example.com/api/"
          onChange={(e) => {
            setUrl(e.target.value);
            setWrites(false);
          }}
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={writes}
          disabled={!ready || busy}
          onChange={(e) => setWrites(e.target.checked)}
        />
        Allow writes to this disposable test API
      </label>
      <p className="fine-print">
        Writes let Aiden create test users and data, then update or delete data it created. Use an
        isolated test environment. Credentials and tokens are hidden from recordings. Unfinished
        checks can be verified manually.
      </p>
      <div className="button-row">
        <button disabled={!ready || busy || !url.trim()} onClick={() => void save()}>
          Save API settings
        </button>
        <button disabled={!ready || busy} onClick={() => void save(true)}>
          Clear API target
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
