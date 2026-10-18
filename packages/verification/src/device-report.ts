import type { DeviceRun } from '../../contracts/src/device-verification.js';

/** Escape application/model text before embedding it in the portable evidence report. */
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
/** Render recorded screenshots as an ordered replay; never imply continuous video or source verification. */
export function renderDeviceReport(run: DeviceRun): string {
  const cards = run.criteria
    .map(
      (item, index) => `<section><h2>${index + 1}. ${escape(item.criterion)}</h2>
${run.source ? `<p>Requirement: ${escape(run.source.checks[index]?.requirementId ?? '')}${run.source.checks[index]?.edgeCaseId ? ` / ${escape(run.source.checks[index].edgeCaseId)}` : ''}. Code assessment: ${escape(run.source.checks[index]?.codeStatus ?? 'unknown')}.</p><p>${escape(run.source.checks[index]?.codeExplanation ?? '')}</p>` : ''}
<p><strong>Installed app: ${escape(item.verdict)}</strong>: ${escape(item.explanation)}</p>
<p>Evidence observations: ${item.evidence.join(', ') || 'None'}</p>
${item.observations
  .map(
    (step) => `<details><summary>${step.id}. ${escape(step.action)} · ${escape(step.at)}</summary>
<p>${escape(step.result)}</p><img src="criterion-${index + 1}/${step.screenshot}" alt="Observation ${step.id}">
<p><a href="criterion-${index + 1}/${step.hierarchy}">Accessibility observation</a></p></details>`,
  )
  .join('')}</section>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
<title>${escape(run.name)} device check</title><style>body{font:16px/1.5 system-ui;max-width:900px;margin:auto;padding:32px;color:#222;background:#fafaf8}section{background:white;border:1px solid #ddd;border-radius:12px;padding:20px;margin:20px 0}img{max-width:100%;max-height:700px}summary{cursor:pointer;padding:10px}code{overflow-wrap:anywhere}</style>
<h1>${escape(run.name)}</h1><p>${escape(run.status)}: ${escape(run.message)}</p>
<p>Installed app: <code>${escape(run.bundleId)}</code>. Build label supplied by tester: ${escape(run.buildLabel)} (not independently attested).</p>
${run.device.appVersion !== undefined ? `<p>Installed version observed on phone: ${escape(run.device.appVersion || 'Unknown')}. Build: ${escape(run.device.appBuild || 'Unknown')}. This does not attest source commit provenance.</p>` : ''}
<p>Device: ${escape(JSON.stringify(run.device))}</p>
<p>Provider: ${escape(run.runtime.provider)}; authentication: ${escape(run.runtime.auth)}; runtime: ${escape(run.runtimeVersion ?? 'No model run')}.</p>
${run.runtimeVersion?.includes('fixture') ? '<p>Produced by a synthetic test fixture, not a live agent.</p>' : ''}
<p>Checks use the running app only. App state persists between criteria. Evidence is a sequence of screenshots, not continuous video. Visual review cannot establish hidden backend behavior.</p>
${run.source ? `<section><h2>Code assessment provenance</h2><p>Project: ${escape(run.source.projectId)}. Report: ${escape(run.source.reportId)}. Baseline: ${escape(run.source.baselineId)}.</p><pre>${escape(JSON.stringify(run.source.snapshots, null, 2))}</pre><p>The installed build’s correspondence to these assessed commits is unverified. App observations supplement the code assessment and do not change its findings.</p></section>` : ''}
${cards}</html>`;
}
