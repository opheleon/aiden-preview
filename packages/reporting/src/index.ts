import type { EstimationSnapshot, Report } from '../../contracts/src/index.js';
/** Render the accepted assessment and evidence references without claiming independent verification. */
export function markdown(r: Report): string {
  return [
    `# ${r.baseline.overview}`,
    `Generated ${r.generatedAt} · ${r.runtime.provider} · baseline ${r.baselineId}`,
    `## Summary\n\n${r.summary}`,
    `## Requirements`,
    ...r.assessments.map(
      (a) =>
        `### ${a.requirementId} · ${a.status}${a.deviation ? ' · deviation' : ''}\n\n${r.baseline.requirements.find((q) => q.id === a.requirementId)?.text}\n\n${a.explanation}\n\n${a.evidence.map((e) => `- ${e.repositoryId} @ ${e.sha}: ${e.path}:${e.startLine}-${e.endLine}: ${e.explanation}`).join('\n')}${a.remainingWork.length ? '\n\nRemaining work:\n' + a.remainingWork.map((w) => '- ' + w).join('\n') : ''}${a.unknowns.length ? '\n\nUnknowns:\n' + a.unknowns.map((w) => '- ' + w).join('\n') : ''}`,
    ),
    `## Deviation findings\n\n${r.deviations.length ? r.deviations.map((d) => `- ${d.requirementId}: ${d.explanation}`).join('\n') : 'No contradictory behavior established.'}`,
    ...(
      [
        ['Risks', r.risks],
        ['Dependencies', r.dependencies],
        ['Milestones', r.baseline.milestones],
        ['Unknowns', r.unknowns],
        ['Coverage and freshness', r.warnings],
      ] satisfies [string, string[]][]
    ).map(
      ([title, values]) =>
        `## ${title}\n\n${values.length ? values.map((v) => '- ' + v).join('\n') : 'None reported.'}`,
    ),
    'Structure and evidence references were checked. This does not independently prove the agent’s conclusions.',
  ].join('\n\n');
}

/** Render estimate provenance, historical comparisons, and forecast limitations for export. */
export function estimationMarkdown(e: EstimationSnapshot): string {
  const forecast = e.forecast;
  const history = new Map(e.history.map((issue) => [issue.id, issue]));
  return [
    '## Estimation',
    `Estimated ${e.generatedAt} · estimator ${e.estimatorVersion} · baseline ${e.baselineId}${e.reportId ? ` · assessment ${e.reportId}` : ''}`,
    ...e.requirements.map((requirement) => {
      const remaining =
        requirement.remainingPoints === null ? 'unknown' : `${requirement.remainingPoints} points`;
      const duration =
        requirement.durationDays === null ||
        requirement.durationOverridden ||
        e.estimatorVersion === '1'
          ? 'unavailable'
          : `${requirement.durationDays} calendar days`;
      const comparisons =
        e.estimatorVersion === '1'
          ? []
          : requirement.comparisons.map((id) => history.get(id)).filter(Boolean);
      const days = comparisons
        .map((issue) => issue!.observedCalendarDays)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      const range =
        days.length >= 3
          ? ` Observed range: ${days[Math.max(0, Math.ceil(days.length * 0.1) - 1)]}–${days[Math.max(0, Math.ceil(days.length * 0.9) - 1)]} calendar days.`
          : '';
      const links = comparisons.length
        ? `\n\nComparisons (${comparisons.length}, collected ${e.historyCollectedAt ?? 'unavailable'}):\n${comparisons.map((issue) => `- ${issue!.url ? `[${issue!.identifier}](${issue!.url})` : issue!.identifier}: ${issue!.title} · ${issue!.observedCalendarDays ?? 'unavailable'} calendar days. ${requirement.remaining?.comparisonMatches?.find((match) => match.id === issue!.id)?.reasoning ?? issue!.reasoning ?? ''}`).join('\n')}`
        : '';
      return `### ${requirement.requirementId} · ${requirement.points} points (${requirement.original.size})\n\n${requirement.original.reasoning}\n\nRemaining: ${remaining}. ${requirement.remaining?.reasoning ?? ''} Historical median: ${duration}.${range}${links}`;
    }),
    '## Scope summary',
    `Reference date: ${forecast.referenceDate}`,
    `Implemented scope: ${forecast.implementedPercent === null ? 'unavailable because assessment coverage is incomplete' : `${forecast.implementedPercent}% (${forecast.implementedPoints}/${forecast.totalPoints} points)`}`,
    `Remaining scope: ${forecast.remainingPoints === null ? 'unknown' : `${forecast.remainingPoints} points`}`,
    ...forecast.limitations.map((value) => `- ${value}`),
    '## Historical calibration',
    e.history.length
      ? `${e.history.length} completed records collected. ${e.historyComplete ? 'Collection reported complete.' : 'Collection was incomplete.'}`
      : 'Time estimates are unavailable until a ticket source provides at least three comparable completed issues with start and finish dates.',
    ...e.historyLimitations.map((value) => `- ${value}`),
    'Estimation artifacts are structurally validated against the reviewed baseline, accepted assessment, and recorded source reads. Model judgments remain estimates.',
  ].join('\n\n');
}

/** Combine compatible assessment and estimation artifacts into a single Markdown export. */
export function markdownBundle(report: Report, estimate: EstimationSnapshot): string {
  return `${markdown(report)}\n\n${estimationMarkdown(estimate)}`;
}
