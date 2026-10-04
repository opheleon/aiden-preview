import { type JSX, useEffect, useState } from 'react';

import type { BetaSettings } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';

/** Explicit opt-in to scheduled post-merge checks against the project's deployed beta. */
export function BetaSchedule({ workspace }: { workspace: Workspace }): JSX.Element {
  const [settings, setSettings] = useState<BetaSettings>({ enabled: false, intervalMinutes: 60 });
  const [loaded, setLoaded] = useState(false);
  const { call, project, action, setNotice, setError } = workspace;
  useEffect(() => {
    let closed = false;
    void call('betaSettings', { projectId: project.id })
      .then((saved) => {
        if (!closed) {
          setSettings(saved);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!closed) setError('Could not load the beta schedule.');
      });
    return () => {
      closed = true;
    };
  }, [call, project.id, setError]);
  return (
    <section className="card settings-panel" aria-label="Beta verification schedule">
      <h2>Beta capabilities</h2>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.codingAgentEnabled === true}
          onChange={(e) => setSettings({ ...settings, codingAgentEnabled: e.target.checked })}
        />
        Enable experimental coding-agent dispatch
      </label>
      <p>
        Off by default. Aiden prepares and tracks delivery tickets. Enable this to explicitly send
        work to Claude Code from the project page. It can edit an isolated worktree, run local
        tests, and create a PR using your selected billing mode. Blocking decisions still pause
        dispatch. Turning this off prevents new jobs; existing jobs remain visible and can be
        stopped.
      </p>
      <h3>Post-merge beta verification</h3>
      <p>
        Local tests belong to the coding agent. Aiden checks the deployed beta after GitHub confirms
        a tracked PR was merged. Checks run on this schedule while Aiden is open and may use your
        selected model allowance.
      </p>
      <p>
        Set the app or API URL above to your beta deployment. The revision endpoint must be on the
        same origin as every configured app and API target and return JSON with the full deployed
        Git SHA, for example <code>{'{"commit":"..."}'}</code>. Aiden waits until beta contains the
        merge commit.
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
        />
        Enable scheduled beta verification after merge
      </label>
      <label>
        Schedule
        <select
          aria-label="Beta verification interval"
          value={settings.intervalMinutes}
          onChange={(e) =>
            setSettings({ ...settings, intervalMinutes: Number(e.target.value) as 60 | 1440 })
          }
        >
          <option value={60}>Hourly</option>
          <option value={1440}>Daily</option>
        </select>
      </label>
      <label>
        Beta revision URL
        <input
          aria-label="Beta revision URL"
          type="url"
          value={settings.revisionUrl ?? ''}
          placeholder="https://beta.example.com/version"
          onChange={(e) => {
            const next = { ...settings };
            if (e.target.value) next.revisionUrl = e.target.value;
            else delete next.revisionUrl;
            setSettings(next);
          }}
        />
      </label>
      <button
        disabled={!loaded}
        onClick={() =>
          void action(async () => {
            setSettings(await call('updateBetaSettings', { projectId: project.id, settings }));
            setNotice('Beta settings saved.');
          })
        }
      >
        Save beta settings
      </button>
    </section>
  );
}
