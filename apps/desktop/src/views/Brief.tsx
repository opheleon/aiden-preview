import { type JSX, type ReactNode, useState } from 'react';

import type { CriterionResult } from '../../../../packages/contracts/src/index';
import type { TicketState } from '../../../../packages/contracts/src/tickets';
import { ActionItems } from '../components/ActionItems';
import { AppCheckResults } from '../components/AppCheckResults';
import { BrowserEvidence } from '../components/BrowserEvidence';
import { CodingDelivery } from '../components/CodingDelivery';
import { DeliveryAttention } from '../components/DeliveryAttention';
import { DeliveryPlan } from '../components/DeliveryPlan';
import { DoneMeans } from '../components/DoneMeans';
import { ProjectConnections } from '../components/ProjectConnections';
import { useProjectGuide } from '../components/ProjectGuide';
import { ProjectProgress } from '../components/ProjectProgress';
import { type ProjectTab, ProjectTabs } from '../components/ProjectTabs';
import { requirementCounts } from '../components/RequirementProgress';
import { useCodingDelivery } from '../hooks/useCodingDelivery';
import { useProjectTab } from '../hooks/useProjectTab';
import { useTrackerTickets } from '../hooks/useTrackerTickets';
import type { Workspace } from '../hooks/useWorkspace';
import { briefData } from '../renderer/brief-data';
import { deliveryAttention } from '../renderer/delivery-attention';
import { BriefHeader } from './BriefHeader';
import { SetupBanner } from './GuideChat';
import { ProjectHistory } from './ProjectHistory';
import { ProjectRunHistory } from './ProjectRunHistory';
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
  onOpen: () => void,
): { text: string; label: string; run: () => void } | null {
  const note = state.note;
  if (!note) return null;
  return {
    text: note.text,
    label: note.recovery === 'look' ? 'Run check again' : 'Try again',
    run: () => {
      onOpen();
      void (note.recovery === 'look'
        ? workspace.lookNow()
        : workspace.editIntent({ context: workspace.project.context }));
    },
  };
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
  const coding = delivery.enabled || delivery.jobs.length > 0;
  const { guide, open: openChat } = useProjectGuide();
  const { tab, select: selectTab } = useProjectTab(workspace, coding);
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
        navigation={<ProjectTabs selected={tab} coding={coding} onSelect={selectTab} />}
        attention={
          <DeliveryAttention
            items={attention}
            busy={busy}
            onCheck={() => {
              openChat({ type: 'run' });
              void workspace.lookNow();
            }}
            onOpen={setOpen}
          />
        }
        progress={
          <ProjectProgress
            workspace={workspace}
            product={product}
            report={report}
            check={check}
            states={stateMap}
            job={delivery.jobs.find((job) => job.baselineId === baseline?.id)}
          />
        }
        note={recovery(workspace, state, () => openChat({ type: 'run' }))}
      />
      <Panel id="overview" tab={tab}>
        <SetupBanner setup={guide.view?.setup} onOpen={openChat} />
        <ActionItems
          title="Needs you"
          items={actions.filter((a) => !a.requirementId || a.call)}
          onAnswer={workspace.answerCall}
          onWatch={setWatching}
          onDone={workspace.confirm}
          onOpen={setOpen}
        />
      </Panel>
      <section hidden={tab !== 'scope' && tab !== 'overview'} aria-label="Delivery plan details">
        {product && (report || !check) && (
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
      </section>
      <div hidden={tab !== 'overview'}>
        <ProjectConnections workspace={workspace} />
      </div>
      <Panel id="scope" tab={tab}>
        {baseline ? (
          <DoneMeans baseline={baseline} context={project.context} busy={busy} />
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
        {check && <AppCheckResults check={check} onWatch={setWatching} />}
        <ProjectRunHistory workspace={workspace} visible={tab === 'activity'} />
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
