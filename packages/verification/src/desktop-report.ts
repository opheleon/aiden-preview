import type { DesktopRun } from '../../contracts/src/desktop-verification.js';

/** Escape application/model text before embedding it in the portable evidence report. */
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Render recorded window screenshots as an ordered replay; never imply video or source verification. */
export function renderDesktopReport(run: DesktopRun): string {
  const app = run.app;
  const updated = app && run.versionAfter && run.versionAfter !== app.version;
  const cards = run.criteria
    .map(
      (item, index) => `<section><h2>${index + 1}. ${escape(item.criterion)}</h2>
<p><strong>Installed app: ${escape(item.verdict)}</strong>: ${escape(item.explanation)}</p>
<p>Evidence observations: ${item.evidence.join(', ') || 'None'}</p>
${item.observations
  .map(
    (step) => `<details><summary>${step.id}. ${escape(step.action)} · ${escape(step.at)}</summary>
<p>${escape(step.result)}</p><img src="criterion-${index + 1}/${step.screenshot}" alt="Observation ${step.id}">
<p><a href="criterion-${index + 1}/${step.tree}">Accessibility observation</a></p></details>`,
  )
  .join('')}</section>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
<title>${escape(run.name)} desktop check</title><style>body{font:16px/1.5 system-ui;max-width:900px;margin:auto;padding:32px;color:#222;background:#fafaf8}section{background:white;border:1px solid #ddd;border-radius:12px;padding:20px;margin:20px 0}img{max-width:100%;max-height:700px}summary{cursor:pointer;padding:10px}code{overflow-wrap:anywhere}</style>
<h1>${escape(run.name)}</h1><p>${escape(run.status)}: ${escape(run.message)}</p>
${app ? `<p>Installed app: ${escape(app.name)} ${escape(app.version)}, identifier <code>${escape(app.identifier)}</code>, at <code>${escape(app.path)}</code>, signed by ${escape(app.signer ?? 'Unknown')} (${escape(app.signature ?? 'unknown')}). This does not attest source commit provenance.</p>` : '<p>The app did not open.</p>'}
${updated ? `<p><strong>The app was updated during this test, to version ${escape(run.versionAfter ?? '')}.</strong> Later observations may come from the new version.</p>` : ''}
<p>The test drove the installed app on this computer. Screenshots show that app's window only. Actions may have changed the app's data and settings.</p>
<p>Provider: ${escape(run.runtime.provider)}; authentication: ${escape(run.runtime.auth)}; runtime: ${escape(run.runtimeVersion ?? 'No model run')}.</p>
${run.runtimeVersion?.includes('fixture') ? '<p>Produced by a synthetic test fixture, not a live agent.</p>' : ''}
<p>Checks use the running app only. App state persists between criteria. Evidence is a sequence of screenshots, not continuous video. Visual review cannot establish hidden backend behavior.</p>
${cards}</html>`;
}
