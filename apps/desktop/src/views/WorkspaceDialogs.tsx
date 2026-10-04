import { X } from 'lucide-react';
import type { JSX } from 'react';

import type { Workspace } from '../hooks/useWorkspace';

/** Show cited code evidence without privileged renderer access. */
export function WorkspaceDialogs({ workspace }: { workspace: Workspace }): JSX.Element {
  const { evidence, setEvidence } = workspace;
  return (
    <>
      {evidence && (
        <div className="modal-overlay">
          <section
            className="modal evidence-modal card"
            role="dialog"
            aria-modal="true"
            aria-label="Code evidence"
          >
            <div className="card-heading">
              <div>
                <h2>{evidence.path}</h2>
                <p>
                  {evidence.repositoryId} · {evidence.sha.slice(0, 12)}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Close evidence"
                onClick={() => setEvidence(undefined)}
              >
                <X size={20} />
              </button>
            </div>
            <p>{evidence.explanation}</p>
            <pre>{evidence.text}</pre>
          </section>
        </div>
      )}
    </>
  );
}
