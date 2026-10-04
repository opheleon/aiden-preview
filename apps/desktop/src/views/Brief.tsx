import { type JSX, useState } from 'react';

import type { CriterionResult } from '../../../../packages/contracts/src/index';
import { ActionItems } from '../components/ActionItems';
import { BrowserEvidence } from '../components/BrowserEvidence';
import { CodingDelivery } from '../components/CodingDelivery';
import { DeliveryAttention } from '../components/DeliveryAttention';
import { DeliveryPlan } from '../components/DeliveryPlan';
import { DeliveryProgress } from '../components/DeliveryProgress';
import { DoneMeans } from '../components/DoneMeans';
import { type ProjectTab, ProjectTabs } from '../components/ProjectTabs';
import { useCodingDelivery } from '../hooks/useCodingDelivery';
import { useTrackerTickets } from '../hooks/useTrackerTickets';
import type { Workspace } from '../hooks/useWorkspace';
import { briefData } from '../renderer/brief-data';
import { deliveryAttention } from '../renderer/delivery-attention';
import { BriefHeader } from './BriefHeader';
import { ProjectHistory } from './ProjectHistory';
const api = window.aiden;

/**
 * The home screen: a brief that reads like a PM's Monday update. Only touch points ask anything of
 * the person; everything else is what Aiden did, found, and decided, with evidence.
 */
export function Brief({ workspace }: { workspace: Workspace }): JSX.Element {
  const { project, baseline } = workspace;
  const busy = workPaused(workspace);
  const [watching, setWatching] = useState<CriterionResult | null>(null);
  const delivery = useCodingDelivery(workspace);
  const tracker = useTrackerTickets(workspace);
  const [selectedTabs, setSelectedTabs] = useState<Record<string, ProjectTab>>({});
  const coding = delivery.enabled || delivery.jobs.length > 0;
  const savedTab = selectedTabs[project.id] ?? 'overview';
  const tab = savedTab === 'coding' && !coding ? 'overview' : savedTab;
  const { report, product, check, stateMap, actions, unverified, state, status, update } =
    briefData(workspace);
  const attention = deliveryAttention({
    product,
    report,
    states: stateMap,
    check,
    tracker: tracker.state,
    runs: workspace.runs,
  });
  return (
    <div className="brief">
      <BriefHeader
        workspace={workspace}
        delivery={delivery}
        {...status}
        showStatus={tab === 'overview'}
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
        note={
          state.note && {
            text: state.note.text,
            label: state.note.recovery === 'look' ? 'Run check again' : 'Try again',
            run: () =>
              void (state.note?.recovery === 'look'
                ? workspace.lookNow()
                : workspace.editIntent({ context: project.context })),
          }
        }
      />
      <section
        className="project-panel"
        role="tabpanel"
        id="project-panel-overview"
        aria-labelledby="project-tab-overview"
        hidden={tab !== 'overview'}
      >
        <ActionItems
          title="Needs you"
          items={actions.filter((a) => !a.requirementId || a.call)}
          onAnswer={workspace.answerCall}
          onWatch={setWatching}
          onDone={workspace.confirm}
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
          />
        )}
      </section>
      <section
        className="project-panel"
        role="tabpanel"
        id="project-panel-scope"
        aria-labelledby="project-tab-scope"
        hidden={tab !== 'scope'}
      >
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
      </section>
      {coding && (
        <section
          className="project-panel"
          role="tabpanel"
          id="project-panel-coding"
          aria-labelledby="project-tab-coding"
          hidden={tab !== 'coding'}
        >
          {baseline && (
            <CodingDelivery key={project.id} workspace={workspace} delivery={delivery} />
          )}
        </section>
      )}
      <section
        className="project-panel"
        role="tabpanel"
        id="project-panel-activity"
        aria-labelledby="project-tab-activity"
        hidden={tab !== 'activity'}
      >
        <ProjectHistory
          workspace={workspace}
          delivery={delivery}
          check={check}
          update={update}
          onWatch={setWatching}
        />
      </section>
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

/** Closed projects preserve their scope and evidence until explicitly reopened. */
function workPaused(workspace: Workspace): boolean {
  return workspace.busy || workspace.project.lifecycle?.status === 'closed';
}
