import { ChevronRight } from 'lucide-react';
import { type JSX, type ReactNode, useState } from 'react';

import type { CriterionResult, Product, Report } from '../../../../packages/contracts/src/index';
import type { TicketState } from '../../../../packages/contracts/src/tickets';
import { requirementBlockers } from '../../../../packages/reporting/src/blockers';
import type { DeliveryTicket as Ticket } from '../../../../packages/reporting/src/tickets';
import { deliveryTickets } from '../../../../packages/reporting/src/tickets';
import type { TrackerTickets } from '../hooks/useTrackerTickets';
import type { Workspace } from '../hooks/useWorkspace';
import type { ActionItem, Risk } from '../renderer/action-items';
import type { DeliveryAttention } from '../renderer/delivery-attention';
import { type FeatureProgress, featureProgress } from '../renderer/delivery-progress';
import {
  type Check,
  type RequirementFacts,
  requirementFacts,
  requirementState,
} from '../renderer/requirement-status';
import { ActionItems, Risks } from './ActionItems';
import { AttentionBadge } from './DeliveryAttention';
import { DeliveryPlanEditor } from './DeliveryPlanEditor';
import { DeliveryTicket } from './DeliveryTicket';
import { RequirementRow } from './RequirementRow';
import { TicketPublishing } from './TicketPublishing';

/** Ordered features own requirements, which in turn own actions, verification gaps, and evidence. */
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
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const facts = report
    ? requirementFacts(report, check, workspace.calls, workspace.confirmed)
    : new Map<string, RequirementFacts>();
  const states = new Map([...facts].map(([id, f]) => [id, requirementState(f)]));
  const blockers = requirementBlockers(product, workspace.calls);
  for (const [id, calls] of blockers)
    if (calls.length)
      states.set(id, { label: 'Blocked', tone: 'partial', how: 'Waiting on a decision.' });
  const progress = featureProgress(product, states);
  const tickets = deliveryTickets(product, report, workspace.calls);
  const focus = progress.find((f) => !f.complete && !f.blocked && !f.waitingOn.length)?.feature.id;
  /** Render a scoped requirement with all its work in the same expandable row. */
  const requirement = (id: string) => {
    const item = product.requirements.find((r) => r.id === id)!;
    const f = facts.get(id);
    const feature = product.deliveryPlan?.find((entry) => entry.requirementIds.includes(id));
    const discrepancy = attention.find((a) => a.requirementIds.includes(id));
    const ticket = (
      <FeatureTicket
        tickets={tickets}
        tracker={tracker.state}
        featureId={feature?.id ?? tickets[product.requirements.indexOf(item)]!.id}
      />
    );
    if (!report || !f)
      return (
        <UncheckedRequirement
          key={id}
          id={id}
          text={item.text}
          attention={discrepancy}
          blocked={!!blockers.get(id)?.length}
        >
          {ticket}
        </UncheckedRequirement>
      );
    const work = actions.filter((a) => a.requirementId === id);
    return (
      <RequirementRow
        key={id}
        requirement={item}
        report={report}
        attention={discrepancy}
        state={requirementState(f)}
        main={f.main}
        edges={f.edges}
        triage={check?.result.triage ?? []}
        onWatch={onWatch}
        actionCount={work.length}
        onOpenEvidence={(index, evidenceIndex) =>
          void workspace.action(async () =>
            workspace.setEvidence(
              await workspace.call('evidence', {
                projectId: workspace.project.id,
                runId: report.id,
                index,
                evidenceIndex,
              }),
            ),
          )
        }
      >
        {ticket}
        <ActionItems
          embedded
          items={work}
          onAnswer={workspace.answerCall}
          onWatch={onWatch}
          onDone={workspace.confirm}
        />
        <Risks risks={risks.filter((r) => r.requirementId === id)} />
      </RequirementRow>
    );
  };
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
        editing={editing}
        onToggle={() => setEditing(!editing)}
      />
      <TicketPublishing key={workspace.project.id} workspace={workspace} tracker={tracker} />
      {editing ? (
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
          onClose={() => setEditing(false)}
        />
      ) : progress.length ? (
        progress.map((item, index) => (
          <FeatureSection
            key={item.feature.id}
            item={item}
            index={index}
            product={product}
            focus={focus}
            attention={attention.find((a) => a.featureId === item.feature.id)}
          >
            {item.feature.requirementIds.map(requirement)}
          </FeatureSection>
        ))
      ) : (
        <>
          <p className="row-sub">
            This project predates delivery planning. Its existing requirement order is preserved.
          </p>
          {product.requirements.map((r) => requirement(r.id))}
        </>
      )}
    </section>
  );
}

/** Explain one feature’s outcome, current position, and dependency links above its requirements. */
function FeatureSection({
  item,
  index,
  product,
  focus,
  attention,
  children,
}: {
  item: FeatureProgress;
  index: number;
  product: Product;
  focus: string | undefined;
  attention: DeliveryAttention | undefined;
  children: ReactNode;
}): JSX.Element {
  const { feature, done, total, complete, waitingOn } = item;
  return (
    <section
      className="delivery-feature"
      id={`feature-${feature.id}`}
      key={feature.id}
      aria-label={feature.title}
    >
      <details className="feature-details">
        <summary className="feature-summary">
          <ChevronRight className="feature-chevron" size={20} aria-hidden="true" />
          <span className="feature-heading">
            <h3>
              {index + 1}. {feature.title}
            </h3>
            <span className="row-sub">
              {done} of {total} requirements complete
            </span>
          </span>
          {attention ? (
            <AttentionBadge item={attention} />
          ) : (
            <span
              className={`chip chip--${complete ? 'verified' : feature.id === focus ? 'pm' : 'neutral'}`}
            >
              {complete
                ? 'Complete'
                : item.blocked
                  ? 'Blocked by a decision'
                  : feature.id === focus
                    ? 'Current focus'
                    : waitingOn.length
                      ? 'Waiting on prerequisites'
                      : 'Up next'}
            </span>
          )}
        </summary>
        <div className="feature-content">
          <p>{feature.outcome}</p>
          <p className="row-sub">
            {feature.kind === 'platform' ? 'Shared platform work · ' : ''}
            {done} of {total} complete. {feature.rationale}
          </p>
          {feature.dependsOn.length > 0 && (
            <p className="row-sub">
              Depends on:{' '}
              {feature.dependsOn.map((id) => (
                <a key={id} href={`#feature-${id}`}>
                  {product.deliveryPlan!.find((f) => f.id === id)?.title}{' '}
                </a>
              ))}
              {waitingOn.length > 0 && ` · Waiting for ${waitingOn.join(', ')}`}
            </p>
          )}
          {(feature.testPlan || feature.kind === 'platform') && (
            <div className="req-block">
              <h4>Test plan</h4>
              <p>
                {feature.testPlan ??
                  'Test plan needed: define a consumer integration check, expected results, and failure or rollback checks before implementation.'}
              </p>
            </div>
          )}
          {children}
        </div>
      </details>
    </section>
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

/** Keep a draft requirement and its linked ticket together before any assessment exists. */
function UncheckedRequirement({
  id,
  text,
  blocked,
  attention,
  children,
}: {
  id: string;
  text: string;
  blocked: boolean;
  attention: DeliveryAttention | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <details className="req-row" id={`requirement-${id}`}>
      <summary>
        <span className="row-title">
          <code>{id}</code> {text}
        </span>
        {attention && <AttentionBadge item={attention} />}
        <span className="row-sub">
          {blocked ? 'Blocked: waiting on a decision' : 'Not checked yet'}
        </span>
      </summary>
      <div className="req-detail">{children}</div>
    </details>
  );
}

/** Keep plan editing optional and available alongside publication controls. */
function PlanHeader({
  workspace,
  product,
  editing,
  onToggle,
}: {
  workspace: Workspace;
  product: Product;
  editing: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="card-label-row">
      <h2 className="card-label">Delivery plan · {product.requirements.length} requirements</h2>
      {product.deliveryPlan ? (
        <button className="text-button" disabled={workspace.busy} onClick={onToggle}>
          {editing ? 'Close editor' : 'Adjust plan'}
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
    </div>
  );
}
