import { Download, RefreshCw, Settings2 } from 'lucide-react';

import brandMark from '../assets/brand-mark.svg';
import type { Area, SettingsTab } from '../hooks/useWorkspaceState';
import type { UpdateStatus } from '../updater';

interface ApplicationHeaderProps {
  area: Area;
  setArea: React.Dispatch<React.SetStateAction<Area>>;
  updateStatus: UpdateStatus | undefined;
  setSettingsTab: React.Dispatch<React.SetStateAction<SettingsTab>>;
}

/** Navigate projects and settings and surface available application updates. */
export function ApplicationHeader(props: ApplicationHeaderProps): React.JSX.Element {
  const { area, setArea, updateStatus, setSettingsTab } = props;
  return (
    <header className="app-header">
      <div className="brand">
        <img src={brandMark} alt="" />
        <strong>Aiden</strong>
        <button
          className={area === 'projects' ? 'header-projects active' : 'header-projects'}
          onClick={() => setArea('projects')}
        >
          Projects
        </button>
      </div>
      <div className="header-right">
        {updateStatus &&
          ['available', 'downloading', 'downloaded'].includes(updateStatus.state) && (
            <button
              className="header-icon update-indicator"
              aria-label={
                updateStatus.state === 'downloaded'
                  ? 'Restart to update'
                  : updateStatus.state === 'downloading'
                    ? `Downloading update ${Math.round(updateStatus.progress?.percent ?? 0)}%`
                    : 'Update available'
              }
              title={
                updateStatus.state === 'downloaded'
                  ? 'Restart to update'
                  : updateStatus.state === 'downloading'
                    ? `Downloading update… ${Math.round(updateStatus.progress?.percent ?? 0)}%`
                    : 'Update available'
              }
              onClick={() => {
                setArea('settings');
                setSettingsTab('desktop');
              }}
            >
              {updateStatus.state === 'downloaded' ? (
                <RefreshCw size={16} />
              ) : (
                <Download size={16} />
              )}
              <span aria-hidden="true" />
            </button>
          )}
        <button
          className={area === 'settings' ? 'header-icon active' : 'header-icon'}
          aria-label="Settings"
          title="Settings"
          onClick={() => setArea('settings')}
        >
          <Settings2 size={16} />
        </button>
        <div className="header-avatar" title="Local workspace">
          A
        </div>
      </div>
    </header>
  );
}
