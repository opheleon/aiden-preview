import { AlertTriangle, Check, X } from 'lucide-react';
import type { JSX } from 'react';

import type { Workspace } from '../hooks/useWorkspace';
const api = window.aiden;

/** Surface recoverable errors, notices, and missing desktop connection. */
export function WorkspaceFeedback({ workspace }: { workspace: Workspace }): JSX.Element {
  const { error, setError, notice, setNotice } = workspace;
  return (
    <>
      {!api && (
        <div className="callout warning">
          <AlertTriangle size={18} />
          <div>
            <strong>Desktop connection required</strong>
            <p>
              This is the interface preview. Open the Electron app to access real files,
              credentials, and analysis.
            </p>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="callout error">
          <AlertTriangle size={18} />
          <div>{error}</div>
          <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="callout">
          <Check size={16} />
          {notice}
          <button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </>
  );
}
