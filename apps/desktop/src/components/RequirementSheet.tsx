import type { JSX, ReactNode } from 'react';

import type { CriterionResult, Report, TriageItem } from '../../../../packages/contracts/src/index';
import type { DeliveryAttention } from '../renderer/delivery-attention';
import { type ItemState, plural } from '../renderer/requirement-status';
import { AttentionBadge } from './DeliveryAttention';
import { Modal } from './Modal';
import { Chip, type OpenEvidence, RequirementDetail, Watch } from './RequirementRow';

type Requirement = Report['baseline']['requirements'][number];

/** The delivery finding for one requirement, shown in full only inside its pop-up. */
function AttentionNote({ item }: { item: DeliveryAttention }): JSX.Element {
  return (
    <section className="req-block sheet-attention" aria-label="Delivery attention">
      <p>
        <AttentionBadge item={item} /> <strong>{item.summary}</strong>
      </p>
      <p>{item.impact}</p>
      <ul>
        {item.evidence.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <p>{item.next}</p>
      {item.remote?.url && (
        <a href={item.remote.url} target="_blank" rel="noreferrer">
          Open {item.remote.issueId ?? 'ticket'}
        </a>
      )}
    </section>
  );
}

/**
 * Everything Aiden knows about one requirement, in a pop-up over the brief: its status and how
 * Aiden knows, any delivery finding, its ticket, the actions it needs, and the evidence. Before a
 * check has run, only the status, the ticket, and any open decision are shown.
 */
export function RequirementSheet({
  requirement,
  feature,
  report,
  state,
  main,
  edges,
  triage,
  attention,
  actionCount = 0,
  onWatch,
  onOpenEvidence,
  onClose,
  children,
}: {
  requirement: Requirement;
  feature: string | undefined;
  report: Report | undefined;
  state: ItemState;
  main?: CriterionResult | undefined;
  edges?: CriterionResult[];
  triage?: TriageItem[];
  attention: DeliveryAttention | undefined;
  actionCount?: number;
  onWatch: (result: CriterionResult) => void;
  onOpenEvidence: OpenEvidence;
  onClose: () => void;
  children?: ReactNode;
}): JSX.Element {
  return (
    <Modal
      label={`Requirement ${requirement.id}`}
      className="requirement-sheet"
      eyebrow={feature ? `${requirement.id} · ${feature}` : requirement.id}
      title={requirement.text}
      onClose={onClose}
    >
      <p className="sheet-status">
        <Chip state={state} />
        <span className="row-sub">
          {state.how}
          {actionCount > 0 && ` · ${plural(actionCount, 'action')} remaining`}
        </span>
        <Watch result={main} label={requirement.id} onWatch={onWatch} />
      </p>
      {attention && <AttentionNote item={attention} />}
      {children}
      {report && (
        <RequirementDetail
          requirement={requirement}
          report={report}
          main={main}
          edges={edges ?? []}
          triage={triage ?? []}
          onWatch={onWatch}
          onOpenEvidence={onOpenEvidence}
        />
      )}
    </Modal>
  );
}
