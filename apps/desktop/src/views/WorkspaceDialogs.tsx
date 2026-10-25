import type { JSX } from 'react';

import { Modal } from '../components/Modal';
import type { Workspace } from '../hooks/useWorkspace';

/** Show cited code evidence without privileged renderer access. */
export function WorkspaceDialogs({ workspace }: { workspace: Workspace }): JSX.Element {
  const { evidence, setEvidence } = workspace;
  return (
    <>
      {evidence && (
        <Modal
          label="Code evidence"
          closeLabel="Close evidence"
          className="evidence-modal w-[900px]"
          title={evidence.path}
          description={`${evidence.repositoryId} · ${evidence.sha.slice(0, 12)}`}
          onClose={() => setEvidence(undefined)}
        >
          <p>{evidence.explanation}</p>
          <pre>{evidence.text}</pre>
        </Modal>
      )}
    </>
  );
}
