import { Power } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type { BackgroundSettings } from '../background';
import type { DesktopBridge } from '../bridge';

/** Explain when Aiden keeps running after its window closes, and set whether it opens at login. */
export function BackgroundSettingsCard({
  api,
}: {
  api: DesktopBridge | undefined;
}): React.JSX.Element {
  const [settings, setSettings] = useState<BackgroundSettings>();
  const [error, setError] = useState('');
  useEffect(() => {
    void api
      ?.getBackgroundSettings()
      .then(setSettings)
      .catch(() => setError('Aiden could not read this setting.'));
  }, [api]);
  /** Save the choice; a failure leaves the checkbox where it was. */
  async function save(openAtLogin: boolean): Promise<void> {
    if (!api) return;
    setError('');
    try {
      setSettings(await api.setBackgroundSettings({ openAtLogin }));
    } catch {
      setError('Aiden could not change this setting. Try again.');
    }
  }
  return (
    <section className="card settings-panel">
      <div className="card-heading">
        <div className="section-icon">
          <Power size={19} />
        </div>
        <div>
          <h2>Running in the background</h2>
          <p>
            While this computer is signed in to Teams and picks up team work, closing the window
            keeps Aiden running in the tray (the menu bar on a Mac), so team work continues. Open or
            quit it from that icon. Otherwise closing the window quits Aiden.
          </p>
        </div>
      </div>
      {settings && (
        <div className="update-preference">
          <label htmlFor="open-at-login">
            <strong>Open Aiden at login</strong>
            <small>
              Starts without a window to pick up team work. When this computer is not signed in to
              Teams, Aiden closes again right away.
            </small>
          </label>
          <input
            id="open-at-login"
            aria-label="Open Aiden at login"
            type="checkbox"
            disabled={!settings.available}
            checked={settings.openAtLogin}
            onChange={(event) => void save(event.target.checked)}
          />
        </div>
      )}
      {settings && !settings.available && (
        <div className="inline-note">
          Opening at login works only in the installed app, not in a development build.
        </div>
      )}
      {error && (
        <p role="alert" className="error update-error">
          {error}
        </p>
      )}
    </section>
  );
}
