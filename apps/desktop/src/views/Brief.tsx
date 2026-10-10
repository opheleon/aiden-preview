import { type JSX, type ReactNode, useState } from 'react';

import type { CriterionResult } from '../../../../packages/contracts/src/index';
import type { TicketState } from '../../../../packages/contracts/src/tickets';
import { ActionItems } from '../components/ActionItems';
import { BrowserEvidence } from '../components/BrowserEvidence';
import { CodingDelivery } from '../components/CodingDelivery';
import { DeliveryAttention } from '../components/DeliveryAttention';
import { DeliveryPlan } from '../components/DeliveryPlan';
import { DeliveryProgress } from '../components/DeliveryProgress';
import { DoneMeans } from '../components/DoneMeans';
import { type ProjectTab, ProjectTabs } from '../components/ProjectTabs';
import { requirementCounts } from '../components/RequirementProgress';
import { useCodingDelivery } from '../hooks/useCodingDelivery';
import { useTrackerTickets } from '../hooks/useTrackerTickets';
import type { Workspace } from '../hooks/useWorkspace';
import { briefData } from '../renderer/brief-data';
import { deliveryAttention } from '../renderer/delivery-attention';
import { BriefHeader } from './BriefHeader';
import { ProjectHistory } from './ProjectHistory';
const api = window.aiden;

/** One tab's content, kept in the page but hidden while another tab is selected. */
function Panel({
  id,
  tab,
  children,
}: {
  id: ProjectTab;
  tab: ProjectTab;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      className="project-panel"
      role="tabpanel"
      id={`project-panel-${id}`}
      aria-labelledby={`project-tab-${id}`}
      hidden={tab !== id}
    >
      {children}
    </section>
  );
}

/** Work that stopped early, with the button that recovers from it. */
function recovery(
  workspace: Workspace,
  state: ReturnType<typeof briefData>['state'],
): { text: string; label: string; run: () => void } | null {
  const note = state.note;
  if (!note) return null;
  return {
    text: note.text,
    label: note.recovery === 'look' ? 'Run check again' : 'Try again',
    run: () =>
      void (note.recovery === 'look'
        ? workspace.lookNow()
        : workspace.editIntent({ context: workspace.project.context })),
  };
}

/** The selected tab, falling back to the overview when the saved tab is no longer offered. */
function currentTab(saved: ProjectTab | undefined, coding: boolean): ProjectTab {
  const tab = saved ?? 'overview';
  return tab === 'coding' && !coding ? 'overview' : tab;
}

/** Delivery findings and whether every requirement is done, from the current brief data. */
function overview(
  workspace: Workspace,
  data: ReturnType<typeof briefData>,
  tracker: TicketState | null,
): { attention: ReturnType<typeof deliveryAttention>; allDone: boolean } {
  const { product, report, stateMap, check } = data;
  const counts = requirementCounts(stateMap, product?.requirements.length ?? 0);
  return {
    attention: deliveryAttention({
      product,
      report,
      states: stateMap,
      check,
      tracker,
      runs: workspace.runs,
    }),
    allDone: !!product && counts.total > 0 && counts.done === counts.total,
  };
}

/**
 * The home screen: a brief that reads like a PM's Monday update. Only touch points ask anything of
 * the person; everything else is what Aiden did, found, and decided, with evidence one click away
 * in a requirement's pop-up.
 */
export function Brief({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, baseline } = workspace;
  const busy = workspace.busy || project.lifecycle?.status === 'closed';
  const [watching, setWatching] = useState<CriterionResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const delivery = useCodingDelivery(workspace);
  const tracker = useTrackerTickets(workspace);
  const [selectedTabs, setSelectedTabs] = useState<Record<string, ProjectTab>>({});
  const coding = delivery.enabled || delivery.jobs.length > 0;
  const tab = currentTab(selectedTabs[project.id], coding);
  const data = briefData(workspace);
  const { report, product, check, stateMap, actions, unverified, state, status, update } = data;
  const { attention, allDone } = overview(workspace, data, tracker.state);
  return (
    <div className="brief">
      <BriefHeader
        workspace={workspace}
        delivery={delivery}
        {...status}
        showStatus={tab === 'overview'}
        allDone={allDone}
        navigation={
          <ProjectTabs
            selected={tab}
            coding={coding}
            onSelect={(next) => setSelectedTabs((current) => ({ ...current, [project.id]: next }))}
          />
        }
        attention={
          <DeliveryAttention
            items={attention}
            busy={busy}
            onCheck={() => void workspace.lookNow()}
            onOpen={setOpen}
          />
        }
        progress={
          product && report ? (
            <DeliveryProgress
              workspace={workspace}
              product={product}
              report={report}
              states={stateMap}
              job={delivery.jobs.find((job) => job.baselineId === baseline?.id)}
            />
          ) : undefined
        }
        note={recovery(workspace, state)}
      />
      <Panel id="overview" tab={tab}>
        <ActionItems
          title="Needs you"
          items={actions.filter((a) => !a.requirementId || a.call)}
          onAnswer={workspace.answerCall}
          onWatch={setWatching}
          onDone={workspace.confirm}
          onOpen={setOpen}
        />
        {product && (
          <DeliveryPlan
            workspace={workspace}
            tracker={tracker}
            attention={attention}
            product={product}
            report={report}
            check={check}
            actions={actions.filter((a) => !a.call)}
            risks={unverified}
            onWatch={setWatching}
            open={open}
            onOpen={setOpen}
          />
        )}
      </Panel>
      <Panel id="scope" tab={tab}>
        {baseline ? (
          <DoneMeans
            baseline={baseline}
            context={project.context}
            busy={busy}
            onEditProduct={(product) => workspace.editIntent({ product })}
            onEditContext={(context) => workspace.editIntent({ context })}
          />
        ) : (
          <p className="brief-card">Aiden has not written the scope yet.</p>
        )}
      </Panel>
      {coding && (
        <Panel id="coding" tab={tab}>
          {baseline && (
            <CodingDelivery key={project.id} workspace={workspace} delivery={delivery} />
          )}
        </Panel>
      )}
      <Panel id="activity" tab={tab}>
        <ProjectHistory
          workspace={workspace}
          delivery={delivery}
          check={check}
          update={update}
          onWatch={setWatching}
        />
      </Panel>
      {watching && check && (
        <BrowserEvidence
          api={api}
          projectId={project.id}
          runId={check.result.runId}
          criterion={watching}
          onClose={() => setWatching(null)}
        />
      )}
    </div>
  );
}
