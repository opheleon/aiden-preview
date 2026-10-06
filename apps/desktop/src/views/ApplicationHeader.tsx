import { Settings2 } from 'lucide-react';

import brandMark from '../assets/brand-mark.svg';
import type { Area } from '../hooks/useWorkspaceState';

interface ApplicationHeaderProps {
  area: Area;
  setArea: React.Dispatch<React.SetStateAction<Area>>;
}

/** Navigate between projects and settings. */
export function ApplicationHeader(props: ApplicationHeaderProps): React.JSX.Element {
  const { area, setArea } = props;
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
