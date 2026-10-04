import type { Product, Report, RunManifest } from '../../../../packages/contracts/src/index';
import type { TicketRecord, TicketState } from '../../../../packages/contracts/src/tickets';
import { remoteDeliveryVerified } from '../../../../packages/reporting/src/delivery-source';
import type { Check, ItemState } from './requirement-status';

/** A delivery discrepancy, separate from implementation progress and transport health. */
export interface DeliveryAttention {
  featureId: string;
  title: string;
  requirementIds: string[];
  kind: 'deviation' | 'checking' | 'unverified';
  label: string;
  summary: string;
  evidence: string[];
  impact: string;
  next: string;
  remote: TicketRecord | undefined;
}

/** Inputs all refer to the current project and reviewed baseline. */
interface AttentionInput {
  product: Product | undefined;
  report: Report | undefined;
  states: Map<string, ItemState>;
  tracker: TicketState | null;
  runs: RunManifest[];
  check?: Check | null;
}

/** The portion of a delivery feature needed to reconcile its completion claim. */
interface Feature {
  id: string;
  title: string;
  requirementIds: string[];
  dependsOn: string[];
}

/** Evidence selected for one feature, with freshness checked before judging a tracker claim. */
interface Finding {
  kind: DeliveryAttention['kind'];
  affected: string[];
  readiness: boolean;
}

/** Reconcile completion claims with evidence, preserving uncertainty while a fresh check is due. */
export function deliveryAttention(input: AttentionInput): DeliveryAttention[] {
  if (!input.product) return [];
  const features: Feature[] =
    input.product.deliveryPlan ??
    input.product.requirements.map((r, index) => ({
      id: `F-${index + 1}`,
      title: r.text,
      requirementIds: [r.id],
      dependsOn: [],
    }));
  return features
    .flatMap((feature): DeliveryAttention[] => {
      const remote = input.tracker?.records.find(
        (r) => r.featureId === feature.id && r.state !== 'retired',
      );
      const finding = featureFinding(input, feature, remote);
      if (!finding) return [];
      const downstream = features
        .filter((f) => f.dependsOn.includes(feature.id))
        .map((f) => f.title);
      return [
        {
          featureId: feature.id,
          title: feature.title,
          requirementIds: finding.affected,
          kind: finding.kind,
          label: attentionLabel(finding.kind),
          summary: attentionSummary(finding.kind, remote),
          evidence: finding.affected.map((id) => evidenceSummary(input, id, finding.readiness)),
          impact: downstream.length
            ? `Delivery of ${downstream.join(', ')} depends on this step.`
            : 'This delivery step cannot be accepted yet.',
          next:
            finding.kind === 'deviation'
              ? 'Review the evidence and complete the remaining work. If the ticket is marked Done, reopen it for correction.'
              : 'Complete the assessment and required acceptance checks before accepting delivery.',
          remote,
        },
      ];
    })
    .sort((a, b) => Number(b.kind === 'deviation') - Number(a.kind === 'deviation'));
}

/** Only known incomplete behavior establishes a deviation; missing evidence remains unverified. */
function featureFinding(
  input: AttentionInput,
  feature: Feature,
  remote: TicketRecord | undefined,
): Finding | undefined {
  const { report, states } = input;
  const remoteVerified = report && remoteDeliveryVerified(report);
  const assessments =
    report?.assessments.filter((a) => feature.requirementIds.includes(a.requirementId)) ?? [];
  const contradicted = feature.requirementIds.filter(
    (id) =>
      (remoteVerified && assessments.some((a) => a.requirementId === id && a.deviation)) ||
      states.get(id)?.label === 'Failing' ||
      input.check?.result.criteria.some((c) => c.requirementId === id && c.verdict === 'fail'),
  );
  const closed = remote?.remoteStatusType === 'completed';
  if (!closed)
    return contradicted.length
      ? { kind: 'deviation', affected: contradicted, readiness: false }
      : undefined;
  const readiness = completionReadiness(input, remote);
  if (readiness) return { kind: readiness, affected: feature.requirementIds, readiness: true };
  const affected = [
    ...new Set([
      ...feature.requirementIds.filter((id) => states.get(id)?.label !== 'Done'),
      ...contradicted,
    ]),
  ];
  if (!affected.length) return undefined;
  const missing =
    remoteVerified &&
    assessments.some(
      (a) => affected.includes(a.requirementId) && ['missing', 'partial'].includes(a.status),
    );
  return {
    kind: contradicted.length || missing ? 'deviation' : 'unverified',
    affected,
    readiness: false,
  };
}

/** A concise label shared by project, feature, and requirement summaries. */
function attentionLabel(kind: DeliveryAttention['kind']): string {
  if (kind === 'deviation') return 'Delivery deviation';
  return kind === 'checking' ? 'Checking completion' : 'Completion unverified';
}

/** Describe the observed discrepancy without treating canceled tickets as completion claims. */
function attentionSummary(
  kind: DeliveryAttention['kind'],
  remote: TicketRecord | undefined,
): string {
  const claim = `${remote?.issueId ?? 'Ticket'} is marked ${remote?.remoteStatus ?? 'Done'}`;
  if (kind === 'checking') return `${claim}. A fresh assessment is pending.`;
  if (kind === 'unverified') return `${claim}. Completion is not established by current evidence.`;
  return remote?.remoteStatusType === 'completed'
    ? `${claim}, but its requirements are incomplete.`
    : 'Observed behavior contradicts the agreed requirements.';
}

/** Keep the short verdict and code explanation together; old evidence is explicitly withheld. */
function evidenceSummary(input: AttentionInput, id: string, pending: boolean): string {
  if (pending) return `${id}: A fresh assessment of this completion claim has not completed.`;
  const assessment = input.report?.assessments.find((a) => a.requirementId === id);
  const failed = input.check?.result.criteria
    .filter((c) => c.requirementId === id && c.verdict === 'fail')
    .map((c) => c.explanation)
    .join(' ');
  return `${id}: ${input.states.get(id)?.how ?? 'Evidence is unavailable.'} ${failed || assessment?.explanation || ''}`.trim();
}

/** A report started before closure cannot establish whether that completion claim is supported. */
function completionReadiness(
  { report, tracker, runs }: AttentionInput,
  remote: TicketRecord,
): 'checking' | 'unverified' | undefined {
  const changed = remote.remoteStatusChangedAt ?? tracker?.externalChangeAt;
  const accepted = runs.find((r) => r.id === report?.id && r.status === 'completed');
  if (report && (!changed || (accepted && accepted.createdAt >= changed))) return undefined;
  const latest = runs.find((r) => r.kind === 'report' && (!changed || r.createdAt >= changed));
  if (latest && ['failed', 'cancelled', 'blocked'].includes(latest.status)) return 'unverified';
  return tracker?.needsAssessment || latest?.status === 'running' ? 'checking' : 'unverified';
}
