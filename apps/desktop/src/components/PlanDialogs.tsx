import type { JSX } from 'react';

import type { Product } from '../../../../packages/contracts/src/index';
import type { TrackerTickets } from '../hooks/useTrackerTickets';
import type { Workspace } from '../hooks/useWorkspace';
import { DeliveryPlanEditor } from './DeliveryPlanEditor';
import { Modal } from './Modal';
import { TicketPublishing } from './TicketPublishing';

/** The plan's pop-ups: the plan editor and ticket publishing, one open at a time. */
export function PlanDialogs({
  workspace,
  product,
  tracker,
  dialog,
  onClose,
}: {
  workspace: Workspace;
  product: Product;
  tracker: TrackerTickets;
  dialog: 'plan' | 'tickets' | null;
  onClose: () => void;
}): JSX.Element | null {
  if (dialog === 'plan')
    return (
      <Modal label="Adjust plan" title="Adjust plan" className="plan-modal" onClose={onClose}>
        <DeliveryPlanEditor
          product={product}
          busy={workspace.busy}
          onSave={async (updated) => {
            const run = await workspace.call('editIntent', {
              projectId: workspace.project.id,
              product: updated,
            });
            workspace.setBusy(true);
            workspace.setActiveRun(run.runId);
            workspace.setLive('Running a check against the updated plan…');
          }}
          onClose={onClose}
        />
      </Modal>
    );
  if (dialog === 'tickets')
    return (
      <Modal label="Tickets" title="Tickets" onClose={onClose}>
        <TicketPublishing key={workspace.project.id} workspace={workspace} tracker={tracker} />
      </Modal>
    );
  return null;
}
