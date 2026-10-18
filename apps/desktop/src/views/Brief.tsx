import { type JSX, useState } from 'react';

import type { CriterionResult } from '../../../../packages/contracts/src/index';
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
import { ProjectTabs } from '../components/ProjectTabs';
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
  const coding = delivery.enabled || delivery.jobs.length > 0;
  const { guide, open } = useProjectGuide();
  const { tab, select: selectTab } = useProjectTab(workspace, coding);
  const { report, product, check, stateMap, actions, unverified, state, status, update } =
    briefData(workspace);
  const showPlan = showsDeliveryPlan(Boolean(report), Boolean(check));
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
        navigation={<ProjectTabs selected={tab} coding={coding} onSelect={selectTab} />}
        attention={
          <DeliveryAttention
            items={attention}
            busy={busy}
            onCheck={() => {
              open({ type: 'run' });
              void workspace.lookNow();
            }}
            onReview={(item) =>
              open({ type: 'finding', requirementId: item.requirementIds[0]!, title: item.title })
            }
            onEvidence={() => {
              selectTab('activity');
              if (!check && report) workspace.setOpenRun(report.id);
            }}
          />
        }
        progress={
          <ProjectProgress
            workspace={workspace}
            product={product}
            report={report}
            states={stateMap}
            check={check}
            job={delivery.jobs.find((job) => job.baselineId === baseline?.id)}
          />
        }
        note={
          state.note && {
            text: state.note.text,
            label: state.note.recovery === 'look' ? 'Run check again' : 'Try again',
            run: () => {
              open({ type: 'run' });
              void (state.note?.recovery === 'look'
                ? workspace.lookNow()
                : workspace.editIntent({ context: project.context }));
            },
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
        <SetupBanner setup={guide.view?.setup} onOpen={open} />
        <ActionItems
          title="Needs you"
          items={actions.filter((a) => !a.requirementId || a.call)}
          onAnswer={workspace.answerCall}
          onWatch={setWatching}
          onDone={workspace.confirm}
        />
      </section>
      <ScopePanel workspace={workspace} hidden={tab !== 'scope'} busy={busy} />
      <section hidden={tab !== 'scope' && tab !== 'overview'} aria-label="Delivery plan details">
        {product && showPlan && (
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
      <div hidden={tab !== 'overview'}>
        <ProjectConnections workspace={workspace} />
      </div>
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
        {check && <AppCheckResults check={check} onWatch={setWatching} />}
        <ProjectRunHistory workspace={workspace} visible={tab === 'activity'} />
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

/** Browse the agreed scope and open changes in the project conversation. */
function ScopePanel({
  workspace,
  hidden,
  busy,
}: {
  workspace: Workspace;
  hidden: boolean;
  busy: boolean;
}): JSX.Element {
  const { baseline, project } = workspace;
  return (
    <section
      className="project-panel"
      role="tabpanel"
      id="project-panel-scope"
      aria-labelledby="project-tab-scope"
      hidden={hidden}
    >
      {baseline ? (
        <DoneMeans baseline={baseline} context={project.context} busy={busy} />
      ) : (
        <p className="brief-card">Aiden has not written the scope yet.</p>
      )}
    </section>
  );
}

/** Closed projects preserve their scope and evidence until explicitly reopened. */
function workPaused(workspace: Workspace): boolean {
  return workspace.busy || workspace.project.lifecycle?.status === 'closed';
}

/** Standalone app results replace code delivery progress when there is no code report. */
function showsDeliveryPlan(hasReport: boolean, hasCheck: boolean): boolean {
  return hasReport || !hasCheck;
}
