import { Download, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';

import type { DesktopBridge } from '../bridge';
import type { UpdatePreferences, UpdateStatus } from '../updater';

interface DesktopUpdateSettingsProps {
  updateStatus: UpdateStatus | undefined;
  updatePreferences: UpdatePreferences;
  saveUpdatePreferences: (next: UpdatePreferences) => void;
  api: DesktopBridge | undefined;
  setUpdateStatus: React.Dispatch<React.SetStateAction<UpdateStatus | undefined>>;
  busy: boolean;
}

/** Present update progress, channel preferences, and explicit restart actions. */
export function DesktopUpdateSettings(props: DesktopUpdateSettingsProps): React.JSX.Element {
  const { updateStatus, updatePreferences, saveUpdatePreferences, api, setUpdateStatus, busy } =
    props;
  return (
    <section className="card settings-panel app-updates-card">
      <div className="card-heading">
        <div className="section-icon">
          <Download size={19} />
        </div>
        <div>
          <h2>App updates</h2>
          <p>Aiden can download signed updates and apply them when you restart.</p>
        </div>
      </div>
      <div className="update-version-list">
        <p>
          Current version <strong>{updateStatus?.currentVersion ?? 'Unknown'}</strong>
        </p>
        {updateStatus?.latestVersion && (
          <p>
            Latest version <strong>{updateStatus.latestVersion}</strong>
          </p>
        )}
        {updateStatus?.lastCheckedAt && (
          <small>Last checked {new Date(updateStatus.lastCheckedAt).toLocaleString()}</small>
        )}
      </div>
      <div className="update-preference">
        <label htmlFor="download-updates">
          <strong>Download updates automatically</strong>
          <small>Updates install only when Aiden restarts.</small>
        </label>
        <input
          id="download-updates"
          aria-label="Download updates automatically"
          type="checkbox"
          checked={updatePreferences.autoDownload}
          onChange={(event) =>
            saveUpdatePreferences({
              ...updatePreferences,
              autoDownload: event.target.checked,
            })
          }
        />
      </div>
      <div className="update-preference">
        <label htmlFor="beta-updates">
          <strong>Receive beta updates</strong>
          <small>Include pre-releases published on GitHub.</small>
        </label>
        <input
          id="beta-updates"
          aria-label="Receive beta updates"
          type="checkbox"
          checked={updatePreferences.channel === 'beta'}
          onChange={(event) =>
            saveUpdatePreferences({
              ...updatePreferences,
              channel: event.target.checked ? 'beta' : 'stable',
            })
          }
        />
      </div>
      <UpdateDetails updateStatus={updateStatus} />
      <UpdateActions
        updateStatus={updateStatus}
        api={api}
        setUpdateStatus={setUpdateStatus}
        busy={busy}
      />
    </section>
  );
}

/** Explain the current update state and preserve explicit installation consent. */
function UpdateDetails({
  updateStatus,
}: Pick<DesktopUpdateSettingsProps, 'updateStatus'>): React.JSX.Element {
  if (!updateStatus) return <></>;
  const progress = Math.round(updateStatus.progress?.percent ?? 0);
  return (
    <>
      {updateStatus.state === 'disabled' && (
        <div className="inline-note">
          Automatic updates are available in the installed desktop app.
        </div>
      )}
      {updateStatus.state === 'up-to-date' && (
        <p className="update-copy">You are on the latest version.</p>
      )}
      {updateStatus.state === 'downloading' && (
        <div className="update-progress">
          <div>
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>Downloading update… {progress}%</small>
        </div>
      )}
      {updateStatus.state === 'downloaded' && (
        <p className="update-copy">
          Update downloaded. Select Restart to update when you are ready to apply it.
        </p>
      )}
      {updateStatus.message && updateStatus.state !== 'disabled' && (
        <p className="update-copy">{updateStatus.message}</p>
      )}
      {updateStatus.state === 'error' && updateStatus.error && (
        <div className="error update-error">{updateStatus.error.message}</div>
      )}
    </>
  );
}
/** Run explicit updater actions and show rejected IPC requests as recoverable errors. */
function UpdateActions({
  updateStatus,
  api,
  setUpdateStatus,
  busy,
}: Pick<
  DesktopUpdateSettingsProps,
  'updateStatus' | 'api' | 'setUpdateStatus' | 'busy'
>): React.JSX.Element {
  const [error, setError] = useState('');
  const state = updateStatus?.state ?? 'idle';
  /** Keep transport failures visible without retrying downloads or restarting the app automatically. */
  async function run(
    operation: 'checkForUpdates' | 'downloadUpdate' | 'installUpdate',
  ): Promise<void> {
    if (!api) return;
    setError('');
    try {
      setUpdateStatus(await api[operation]());
    } catch {
      setError('The update operation failed. Check your connection and try again.');
    }
  }
  if (state === 'disabled') return <></>;
  const check =
    ['idle', 'up-to-date', 'checking'].includes(state) ||
    (state === 'error' && !updateStatus?.latestVersion);
  const download = state === 'available' || (state === 'error' && !!updateStatus?.latestVersion);
  return (
    <>
      <div className="button-row">
        {check && (
          <button
            className="secondary"
            disabled={state === 'checking'}
            onClick={() => void run('checkForUpdates')}
          >
            <RefreshCw size={14} />
            {state === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
        {download && (
          <button className="primary" onClick={() => void run('downloadUpdate')}>
            <Download size={14} /> Download update
          </button>
        )}
        {state === 'downloaded' && (
          <button className="primary" disabled={busy} onClick={() => void run('installUpdate')}>
            <RefreshCw size={14} /> Restart to update
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error update-error">
          {error}
        </p>
      )}
    </>
  );
}
