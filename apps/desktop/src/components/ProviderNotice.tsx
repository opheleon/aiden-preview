import { CircleAlert } from 'lucide-react';
import type { JSX } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
import { providerName, runtimeReady } from '../renderer/runtime-readiness';

/**
 * Say at the top of the project chat when the project's model is not connected, since nothing in
 * the chat can work until it is, and open Settings → Model to fix it.
 */
export function ProviderNotice({ workspace }: { workspace: Workspace }): JSX.Element | null {
  const { project, diagnostics } = workspace;
  if (runtimeReady(diagnostics, project.runtime) !== false) return null;
  const name = providerName(project.runtime.provider);
  return (
    <div className="start-blocker provider-notice" role="status">
      <CircleAlert size={16} />
      <span>
        <b>Connect {name}:</b> Aiden answers and checks the work through your {name} account.
      </span>
      <button
        className="start-blocker-action"
        onClick={() => {
          workspace.setSettingsTab('model');
          workspace.setArea('settings');
        }}
      >
        Open Settings → Model
      </button>
    </div>
  );
}
