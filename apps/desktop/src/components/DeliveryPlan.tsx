import { type JSX, useState } from 'react';

import type { CriterionResult, Product, Report } from '../../../../packages/contracts/src/index';
import type { TicketState } from '../../../../packages/contracts/src/tickets';
import { type BlockerSources, blockerSources } from '../../../../packages/reporting/src/blockers';
import type { DeliveryTicket as Ticket } from '../../../../packages/reporting/src/tickets';
import { deliveryTickets } from '../../../../packages/reporting/src/tickets';
import type { TrackerTickets } from '../hooks/useTrackerTickets';
import type { Workspace } from '../hooks/useWorkspace';
import type { ActionItem, Risk } from '../renderer/action-items';
import type { DeliveryAttention } from '../renderer/delivery-attention';
import { featureProgress } from '../renderer/delivery-progress';
import {
  type Check,
  type ItemState,
  type RequirementFacts,
  requirementFacts,
  requirementState,
} from '../renderer/requirement-status';
import { ActionItems, Risks } from './ActionItems';
import { DeliveryTicket } from './DeliveryTicket';
import { FeatureSection } from './FeatureSection';
import { PlanDialogs } from './PlanDialogs';
import { RequirementRow } from './RequirementRow';
import { RequirementSheet } from './RequirementSheet';
import { TicketAlerts } from './TicketPublishing';

/** A requirement no check has reached yet. */
const unchecked: ItemState = { label: 'Not checked', tone: 'neutral', how: 'Not checked yet.' };

/** What the plan knows about one requirement, shared by its row and its pop-up. */
export interface RequirementView {
  item: Product['requirements'][number];
  feature: string | undefined;
  facts: RequirementFacts | undefined;
  state: ItemState;
  attention: DeliveryAttention | undefined;
  work: ActionItem[];
  ticket: JSX.Element | null;
}

/**
 * Ordered features own requirements, shown as one line each. A requirement's actions, ticket,
 * verification gaps, and evidence open in a pop-up; plan editing and ticket publishing do too.
 */
export function DeliveryPlan({
  workspace,
  product,
  report,
  check,
  actions,
  risks,
  onWatch,
  deliveryNote,
  tracker,
  attention,
  open,
  onOpen,
}: {
  workspace: Workspace;
  tracker: TrackerTickets;
  attention: DeliveryAttention[];
  product: Product;
  report: Report | undefined;
  check: Check | null;
  actions: ActionItem[];
  risks: Risk[];
  onWatch: (result: CriterionResult) => void;
  deliveryNote?: string | undefined;
  /** The requirement whose pop-up is open, if any. */
  open: string | null;
  onOpen: (id: string | null) => void;
}): JSX.Element {
  const [dialog, setDialog] = useState<'plan' | 'tickets' | null>(null);
  const facts = report
    ? requirementFacts(report, check, workspace.calls, workspace.confirmed)
    : new Map<string, RequirementFacts>();
  const blockers = blockerSources(product, workspace.calls);
  const states = planStates(facts, blockers);
  const progress = featureProgress(product, states);
  const tickets = deliveryTickets(product, report, workspace.calls);
  const focus = progress.find((f) => !f.complete && !f.blocked && !f.waitingOn.length)?.feature.id;
  /** Gather one requirement's row and pop-up inputs from the plan, report, and tracker. */
  const view = (id: string): RequirementView => {
    const item = product.requirements.find((r) => r.id === id)!;
    const feature = product.deliveryPlan?.find((entry) => entry.requirementIds.includes(id));
    const featureId = feature?.id ?? tickets[product.requirements.indexOf(item)]!.id;
    const f = facts.get(id);
    return {
      item,
      feature: feature?.title,
      facts: f,
      // A checked requirement explains its own decision; an unchecked one shows the plan's view.
      state: f ? requirementState(f) : (states.get(id) ?? unchecked),
      attention: attention.find((a) => a.requirementIds.includes(id)),
      work: actions.filter((a) => a.requirementId === id),
      ticket: <FeatureTicket tickets={tickets} tracker={tracker.state} featureId={featureId} />,
    };
  };
  /** One line on the brief for a requirement. */
  const row = (id: string): JSX.Element => {
    const v = view(id);
    return (
      <RequirementRow
        key={id}
        id={id}
        text={v.item.text}
        state={v.state}
        main={v.facts?.main}
        onWatch={onWatch}
        onOpen={onOpen}
        actionCount={v.work.length}
        attention={v.attention}
      />
    );
  };
  const opened = open && product.requirements.some((r) => r.id === open) ? view(open) : null;
  return (
    <section className="brief-card delivery-plan" aria-label="Requirements">
      {deliveryNote && (
        <p role="status">
          {deliveryNote} The plan below retains its last assessed requirement states.
        </p>
      )}
      <PlanHeader
        workspace={workspace}
        product={product}
        tracker={tracker.state}
        onAdjust={() => setDialog('plan')}
        onTickets={() => setDialog('tickets')}
      />
      <TicketAlerts state={tracker.state} />
      {progress.length ? (
        progress.map((item) => (
          <FeatureSection
            key={item.feature.id}
            item={item}
            product={product}
            focus={focus}
            attention={attention.find((a) => a.featureId === item.feature.id)}
          >
            {item.feature.requirementIds.map(row)}
          </FeatureSection>
        ))
      ) : (
        <>
          <p className="row-sub">
            This project predates delivery planning. Its existing requirement order is preserved.
          </p>
          <ul className="req-rows">{product.requirements.map((r) => row(r.id))}</ul>
        </>
      )}
      <PlanDialogs
        workspace={workspace}
        product={product}
        tracker={tracker}
        dialog={dialog}
        onClose={() => setDialog(null)}
      />
      {opened && (
        <OpenedRequirement
          workspace={workspace}
          view={opened}
          report={report}
          check={check}
          risks={risks}
          onWatch={onWatch}
          onClose={() => onOpen(null)}
        />
      )}
    </section>
  );
}

/** The pop-up for one requirement: its ticket, actions, verification gaps, and evidence. */
function OpenedRequirement({
  workspace,
  view,
  report,
  check,
  risks,
  onWatch,
  onClose,
}: {
  workspace: Workspace;
  view: RequirementView;
  report: Report | undefined;
  check: Check | null;
  risks: Risk[];
  onWatch: (result: CriterionResult) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <RequirementSheet
      requirement={view.item}
      feature={view.feature}
      report={report}
      state={view.state}
      main={view.facts?.main}
      edges={view.facts?.edges ?? []}
      triage={check?.result.triage ?? []}
      attention={view.attention}
      actionCount={view.work.length}
      onWatch={onWatch}
      onOpenEvidence={(index, evidenceIndex) =>
        void workspace.action(async () =>
          workspace.setEvidence(
            await workspace.call('evidence', {
              projectId: workspace.project.id,
              runId: report!.id,
              index,
              evidenceIndex,
            }),
          ),
        )
      }
      onClose={onClose}
    >
      {view.ticket}
      <ActionItems
        embedded
        items={view.work}
        onAnswer={workspace.answerCall}
        onWatch={onWatch}
        onDone={workspace.confirm}
      />
      <Risks risks={risks.filter((r) => r.requirementId === view.item.id)} />
    </RequirementSheet>
  );
}

/** Match a local feature with its persisted external identity. */
function FeatureTicket({
  tickets,
  tracker,
  featureId,
}: {
  tickets: Ticket[];
  tracker: TicketState | null;
  featureId: string;
}): JSX.Element | null {
  const ticket = tickets.find((t) => t.id === featureId);
  return ticket ? (
    <DeliveryTicket
      ticket={ticket}
      remote={tracker?.records.find((r) => r.featureId === featureId)}
    />
  ) : null;
}

/**
 * Requirement states for the plan, where open decisions outrank assessed code: a requirement's own
 * decision shows Blocked, and a prerequisite's decision shows Waiting.
 */
function planStates(
  facts: Map<string, RequirementFacts>,
  blockers: Map<string, BlockerSources>,
): Map<string, ItemState> {
  const states = new Map([...facts].map(([id, f]) => [id, requirementState(f)]));
  for (const [id, { direct, inherited }] of blockers)
    if (direct.length)
      states.set(id, { label: 'Blocked', tone: 'partial', how: 'Waiting on a decision.' });
    else if (inherited.length)
      states.set(id, {
        label: 'Waiting',
        tone: 'partial',
        how: 'Waiting on a decision for a prerequisite feature.',
      });
  return states;
}

/** The plan's title line with its two pop-ups: adjusting the plan and publishing tickets. */
function PlanHeader({
  workspace,
  product,
  tracker,
  onAdjust,
  onTickets,
}: {
  workspace: Workspace;
  product: Product;
  tracker: TicketState | null;
  onAdjust: () => void;
  onTickets: () => void;
}): JSX.Element {
  const provider = tracker?.settings?.destination.provider;
  const linked = provider ? (provider === 'linear' ? 'Linear' : 'Jira') : null;
  return (
    <div className="card-label-row">
      <h2 className="card-label">Delivery plan · {product.requirements.length} requirements</h2>
      <div className="button-row">
        {product.deliveryPlan ? (
          <button
            className="text-button"
            aria-haspopup="dialog"
            disabled={workspace.busy}
            onClick={onAdjust}
          >
            Adjust plan
          </button>
        ) : (
          <button
            className="text-button"
            disabled={workspace.busy}
            onClick={() => void workspace.editIntent({ context: workspace.project.context })}
          >
            Plan delivery
          </button>
        )}
        <button className="text-button" aria-haspopup="dialog" onClick={onTickets}>
          {linked ? `Tickets · ${linked}` : 'Tickets'}
        </button>
      </div>
    </div>
  );
}
