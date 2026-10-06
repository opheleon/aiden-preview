import { Download, RefreshCw } from 'lucide-react';
import { type Dispatch, type JSX, type SetStateAction, useState } from 'react';

import type { DesktopBridge } from '../bridge';
import type { UpdateStatus } from '../updater';

type Operation = 'checkForUpdates' | 'downloadUpdate' | 'installUpdate';

/** Select the explicit updater action without changing download or release-channel preferences. */
function updateAction(status: UpdateStatus): { label: string; operation: Operation } {
  switch (status.state) {
    case 'downloaded':
      return { label: 'Restart to update', operation: 'installUpdate' };
    case 'available':
      return { label: 'Download update', operation: 'downloadUpdate' };
    case 'error':
      return {
        label: 'Retry update',
        operation: status.latestVersion ? 'downloadUpdate' : 'checkForUpdates',
      };
    case 'disabled':
    case 'checking':
    case 'idle':
    case 'downloading':
    case 'up-to-date':
      return { label: 'Check for updates', operation: 'checkForUpdates' };
  }
}

/** Explain version, completion, and active-work restrictions beside the update action. */
function updateDetail(status: UpdateStatus, busy: boolean): string {
  if (status.state === 'downloaded') {
    if (busy) return 'Finish the current run to restart.';
    if (status.message) return status.message;
  }
  if (status.state === 'up-to-date') return 'You’re up to date';
  return status.latestVersion
    ? `Version ${status.latestVersion}`
    : `Aiden ${status.currentVersion}`;
}

/** Derive the visible action and disabled state from download progress and in-flight IPC. */
function updatePresentation(status: UpdateStatus, pending: Operation | null, busy: boolean) {
  const action = updateAction(status);
  const downloading = status.state === 'downloading' || pending === 'downloadUpdate';
  const checking = status.state === 'checking' || pending === 'checkForUpdates';
  const ready = status.state === 'downloaded';
  const percent = Math.max(0, Math.min(100, Math.round(status.progress?.percent ?? 0)));
  return {
    ...action,
    downloading,
    ready,
    percent,
    disabled: !!pending || downloading || checking || (ready && busy),
    detail: updateDetail(status, busy),
    label: downloading
      ? `Downloading… ${percent}%`
      : checking
        ? 'Checking for updates…'
        : action.label,
  };
}

/** Expose updates in the sidebar, with progress and explicit, active-work-safe installation. */
export function SidebarUpdate({
  updateStatus,
  setUpdateStatus,
  busy,
  api,
}: {
  updateStatus: UpdateStatus | undefined;
  setUpdateStatus: Dispatch<SetStateAction<UpdateStatus | undefined>>;
  busy: boolean;
  api: DesktopBridge | undefined;
}): JSX.Element | null {
  const [pending, setPending] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  if (!api || !updateStatus || updateStatus.state === 'disabled') return null;
  const view = updatePresentation(updateStatus, pending, busy);
  const failure = error || (updateStatus.state === 'error' ? 'The update failed. Try again.' : '');
  /** Show safe retry feedback for IPC failures; the trusted updater rechecks all active work. */
  async function run(): Promise<void> {
    if (!api || pending) return;
    setPending(view.operation);
    setError('');
    try {
      setUpdateStatus(await api[view.operation]());
    } catch {
      setError('Could not update Aiden. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="sidebar-update" aria-label="App update">
      <button
        className={`sidebar-update-button${updateStatus.latestVersion ? ' update-ready' : ''}`}
        disabled={view.disabled}
        onClick={() => void run()}
        aria-label={view.label}
        title={view.detail}
      >
        <span className="sidebar-update-icon" aria-hidden="true">
          {view.ready ? <RefreshCw size={17} /> : <Download size={17} />}
        </span>
        <span className="sidebar-update-label">
          <strong>{view.label}</strong>
          <small>{view.detail}</small>
        </span>
      </button>
      {view.downloading && (
        <progress aria-label="Update download progress" max={100} value={view.percent} />
      )}
      {failure && <p role="alert">{failure}</p>}
    </section>
  );
}
