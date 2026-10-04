import type { Call, DeliveryFeature, Product, Report } from '../../contracts/src/index.js';
import { blockerReason, requirementBlockers } from './blockers.js';

/** A local delivery ticket derived from saved scope and evidence, never a claim of an external issue. */
export interface DeliveryTicket {
  id: string;
  title: string;
  blocked: boolean;
  markdown: string;
}

/** Write one ticket per vertical feature in agreed order; legacy plans get one per requirement. */
export function deliveryTickets(
  product: Product,
  report: Report | undefined,
  calls: Call[],
): DeliveryTicket[] {
  const blockers = requirementBlockers(product, calls);
  const features: DeliveryFeature[] =
    product.deliveryPlan ??
    product.requirements.map((r, i) => ({
      id: `F-${i + 1}`,
      title: r.text,
      outcome: r.text,
      kind: 'feature',
      rationale: 'Requirement from saved scope.',
      requirementIds: [r.id],
      dependsOn: [],
    }));
  return features.map((feature) => {
    const blocked = [...new Set(feature.requirementIds.flatMap((id) => blockers.get(id) ?? []))];
    const lines = [
      `# ${feature.id}: ${feature.title}`,
      '',
      `Status: ${blocked.length ? 'Blocked, draft scope' : 'Planned, check prerequisites before implementation'}`,
      'Owner: Unassigned',
      `Dependencies: ${feature.dependsOn.join(', ') || 'None'}`,
      '',
      '## Outcome',
      feature.outcome,
      '',
      `Scope basis: ${report ? `assessment ${report.id}` : 'saved project requirements'}`,
    ];
    if (blocked.length)
      lines.push(
        '',
        '## Decision needed',
        blockerReason(blocked),
        'Implementation and dependent work are paused. Resolve these decisions before finalizing acceptance criteria or implementation steps.',
      );
    lines.push(
      '',
      blocked.length ? '## Draft scope (not acceptance criteria)' : '## Acceptance criteria',
    );
    for (const id of feature.requirementIds) {
      const requirement = product.requirements.find((r) => r.id === id)!;
      lines.push(
        `- ${id}: ${requirement.text}`,
        ...(requirement.edgeCases ?? []).map((e) => `- ${id} ${e.id}: ${e.text}`),
      );
    }
    if (!blocked.length) {
      const assessments = (report?.assessments ?? []).filter((a) =>
        feature.requirementIds.includes(a.requirementId),
      );
      lines.push(
        '',
        '## Known remaining work',
        ...assessments.flatMap((a) => a.remainingWork).map((w) => `- ${w}`),
      );
      if (!assessments.length)
        lines.push(
          'Code assessment pending. Confirm the current implementation before selecting changes.',
        );
      lines.push(
        '',
        '## Evidence',
        ...assessments.flatMap((a) => [
          `${a.requirementId}: ${a.explanation}`,
          ...a.evidence.map(
            (e) => `- ${e.repositoryId}/${e.path}:${e.startLine}-${e.endLine} (${e.sha})`,
          ),
          ...a.unknowns.map((u) => `- Investigation needed: ${u}`),
        ]),
        '',
        '## Verification',
        feature.testPlan ??
          (feature.kind === 'platform'
            ? 'Test plan needed before implementation: identify the concrete consumers, exercise a real consumer against the foundation, and define contract, failure, and migration or rollback checks as applicable. Record expected results and executable evidence before dependent work proceeds.'
            : 'Test the complete vertical behavior and failure paths against the acceptance criteria. Record local checks and browser or API evidence as applicable. Code presence alone does not establish delivery.'),
        '',
        '## Delivery rules',
        'Confirm prerequisite tickets are complete. If unknown core behavior or a required prerequisite emerges, investigate and then ask a focused question; pause affected work until resolved. Follow agreed scope and repository conventions for reversible details. Report only work and checks actually completed.',
      );
    }
    return {
      id: feature.id,
      title: feature.title,
      blocked: !!blocked.length,
      markdown: lines.join('\n'),
    };
  });
}
