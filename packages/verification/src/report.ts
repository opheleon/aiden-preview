import type {
  CriterionResult,
  PageCheck,
  VerificationAttempt,
  VerificationResult,
} from '../../contracts/src/index.js';
import { reasonLabels } from './verdict.js';

const entities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const badges = { pass: 'Verified', fail: 'Failed', unverified: "Couldn't verify" } as const;

/** Replace em dashes from model or page text with ordinary punctuation for user-facing copy. */
export function plainText(value: string): string {
  return value.replace(/\s*—\s*/g, ', ');
}

/** Escape untrusted page and model text for HTML text and attribute positions. */
function text(value: string): string {
  return plainText(value).replace(/[&<>"']/g, (c) => entities[c] ?? c);
}

/** Format a video offset as minutes and seconds. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Name the runtime honestly; fixture runs are never presented as live agent output. */
function runtimeLabel(runtime: VerificationResult['runtime']): string {
  if (runtime.version.includes('fixture')) return 'Produced by a test fixture, not a live agent.';
  const provider = runtime.provider === 'claude' ? 'Claude' : 'Codex';
  const auth = runtime.auth === 'subscription' ? 'subscription' : 'API key';
  return `Checked live by ${provider} (${auth}), model ${runtime.model ?? 'default'}, runtime ${runtime.version}.`;
}

/** Render the proof screenshot and a video that opens at the proof timestamp. */
function evidence(attempt: VerificationAttempt, proof: PageCheck | null, key: string): string {
  const start = proof ? proof.atMs / 1000 : 0;
  const video = `<video id="${key}" controls preload="metadata" src="${text(attempt.video)}#t=${start.toFixed(1)}"></video>`;
  if (!proof)
    return `<div class="media single"><figure>${video}<figcaption>Full recording of this check.</figcaption></figure></div>`;
  return `<div class="media">
  <figure><a href="${text(proof.screenshot)}"><img src="${text(proof.screenshot)}" alt="Proof screenshot with the checked element outlined in red"></a>
  <figcaption>Proof: ${text(proof.actual)}</figcaption></figure>
  <figure>${video}<figcaption>Recording. <button type="button" data-video="${key}" data-seek="${start.toFixed(1)}">Jump to proof at ${clock(proof.atMs)}</button></figcaption></figure>
</div>`;
}

/** List each logged step with its reasoning, a screenshot link, and a video jump. */
function steps(attempt: VerificationAttempt, key: string): string {
  if (attempt.steps.length === 0) return '<p class="muted">No browser steps were taken.</p>';
  const rows = attempt.steps.map(
    (step) => `<li>
  <button type="button" class="time" data-video="${key}" data-seek="${(step.atMs / 1000).toFixed(1)}">${clock(step.atMs)}</button>
  <div><strong>${text(step.action)}</strong><span class="muted"> ${text(step.reasoning)}</span>
  <div class="result">${text(step.result)}${step.screenshot ? ` <a href="${text(step.screenshot)}">Screenshot</a>` : ''}</div></div>
</li>`,
  );
  return `<ol class="steps">${rows.join('\n')}</ol>`;
}

/** Summarize one attempt's own verdict for criteria that were checked twice. */
function attemptLine(attempt: VerificationAttempt): string {
  const verdict =
    attempt.verdict === 'unverified'
      ? reasonLabels[attempt.reason ?? 'other']
      : `${badges[attempt.verdict]}.`;
  return `Run ${attempt.attempt}: ${text(verdict)} ${text(attempt.explanation)}`;
}

/** Name what a criterion card checked: a requirement or one of its edge cases, and who Aiden acted as. */
function criterionLabel(criterion: CriterionResult): string {
  const item = criterion.edgeCaseId
    ? `${criterion.requirementId} edge case ${criterion.edgeCaseId}`
    : criterion.requirementId;
  return `${criterion.method === 'api' ? 'API · ' : ''}${text(criterion.persona ? `${item} as ${criterion.persona}` : item)}`;
}

/** Render one criterion card with verdict, explanation, proof, recording, and step log. */
function criterionCard(criterion: CriterionResult, index: number): string {
  const decisive =
    criterion.attempts.find((a) => a.attempt === criterion.decisiveAttempt) ??
    criterion.attempts[0];
  const key = `video-${index}`;
  const reason =
    criterion.verdict === 'unverified' && criterion.reason
      ? `<p class="reason">${text(reasonLabels[criterion.reason])}</p>`
      : '';
  const contrast =
    criterion.verdict === 'fail' && (criterion.expected || criterion.observed)
      ? `<dl class="contrast"><div><dt>Expected</dt><dd>${text(criterion.expected ?? 'Not stated.')}</dd></div><div><dt>What happened</dt><dd>${text(criterion.observed ?? 'Not stated.')}</dd></div></dl>`
      : '';
  const retries =
    criterion.attempts.length > 1
      ? `<div class="runs"><p><strong>Checked twice in fresh browsers.</strong></p><ul>${criterion.attempts.map((a) => `<li>${attemptLine(a)}</li>`).join('')}</ul></div>`
      : '';
  const others = criterion.attempts
    .filter((a) => a !== decisive)
    .map(
      (a, i) =>
        `<details><summary>Run ${a.attempt} recording and steps</summary>${evidence(a, a.proof, `${key}-${i}`)}${steps(a, `${key}-${i}`)}</details>`,
    )
    .join('');
  return `<article class="card ${criterion.verdict}">
  <header><span class="badge">${badges[criterion.verdict]}</span><span class="id">${criterionLabel(criterion)}</span></header>
  <h2>${text(criterion.criterion)}</h2>
  ${reason}
  <p class="explanation">${text(criterion.explanation)}</p>
  ${contrast}
  ${decisive ? evidence(decisive, criterion.verdict === 'unverified' && criterion.reason === 'inconsistent_results' ? null : decisive.proof, key) : ''}
  ${retries}
  ${decisive ? `<details><summary>Steps Aiden took (${decisive.steps.length})</summary>${steps(decisive, key)}</details>` : ''}
  ${others}
</article>`;
}

const styles = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--muted:#5f5f5a;--line:#e3e3de;--pass:#137a3a;--pass-bg:#e6f4ea;--fail:#b42318;--fail-bg:#fdecea;--unv:#8a5a00;--unv-bg:#fdf3dc;--accent:#2b59c3}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#20201e;--ink:#ecece8;--muted:#a3a39c;--line:#34342f;--pass:#6fd08c;--pass-bg:#16301f;--fail:#f7867a;--fail-bg:#3a1b17;--unv:#f1c66b;--unv-bg:#352a12;--accent:#8fb0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:8px 0}
.muted,.meta{color:var(--muted)}.meta{margin:0 0 20px;font-size:14px}
.summary{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:24px}
.summary p{font-size:20px;font-weight:600;margin:0 0 12px}.counts{display:flex;gap:12px;flex-wrap:wrap}
.count{padding:6px 12px;border-radius:999px;font-weight:600;font-size:14px}
.count.pass,.pass .badge{background:var(--pass-bg);color:var(--pass)}.count.fail,.fail .badge{background:var(--fail-bg);color:var(--fail)}.count.unverified,.unverified .badge{background:var(--unv-bg);color:var(--unv)}
.card{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--line);border-radius:12px;padding:20px;margin-bottom:20px}
.card.pass{border-left-color:var(--pass)}.card.fail{border-left-color:var(--fail)}.card.unverified{border-left-color:var(--unv)}
.card header{display:flex;gap:10px;align-items:center}.badge{padding:3px 10px;border-radius:999px;font-weight:700;font-size:13px}.id{color:var(--muted);font-size:13px}
.reason{font-weight:600;color:var(--unv);margin:4px 0}.explanation{margin:6px 0 12px}
.contrast{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 12px}.contrast div{border:1px solid var(--line);border-radius:8px;padding:10px}
dt{font-size:13px;font-weight:700;color:var(--muted)}dd{margin:2px 0 0}
.media{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0}.media.single{grid-template-columns:1fr}
figure{margin:0}img,video{width:100%;border:1px solid var(--line);border-radius:8px;display:block;background:#000}
figcaption{font-size:14px;color:var(--muted);margin-top:6px}
button{font:inherit;font-size:14px;color:var(--accent);background:none;border:1px solid var(--line);border-radius:6px;padding:2px 8px;cursor:pointer}
a{color:var(--accent)}details{margin-top:10px}summary{cursor:pointer;font-weight:600}
.steps{list-style:none;padding:0;margin:8px 0}.steps li{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
.time{flex:none;min-width:56px}.result{font-size:14px;color:var(--muted)}.runs ul{margin:4px 0;padding-left:20px}
footer{color:var(--muted);font-size:13px;margin-top:32px}
@media (max-width:720px){.media,.contrast{grid-template-columns:1fr}}
`;

const script = `document.addEventListener('click',function(e){var b=e.target.closest('[data-seek]');if(!b)return;var v=document.getElementById(b.getAttribute('data-video'));if(!v)return;v.currentTime=Number(b.getAttribute('data-seek'));v.scrollIntoView({block:'center'});v.play();});`;

/** Build a standalone report a non-technical reader can open from disk; media paths are relative. */
export function renderReport(result: VerificationResult): string {
  const { summary } = result;
  const generated = new Date(result.generatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(result.projectName)} acceptance check</title>
<style>${styles}</style>
</head>
<body>
<main>
<h1>${text(result.projectName)} ${result.environment === 'beta' ? 'beta verification' : 'acceptance check'}</h1>
${result.deploymentRevision ? `<p>Deployed revision: ${text(result.deploymentRevision)}</p>` : ''}
<p class="meta">Aiden tested ${text(result.url)} using recorded checks on ${text(generated)}. ${text(runtimeLabel(result.runtime))}</p>
<section class="summary" aria-label="Summary">
<p>${result.partial ? 'Check still in progress. Results below are completed criteria only. ' : ''}${text(summary.line)}</p>
<div class="counts"><span class="count pass">${summary.verified} verified</span><span class="count fail">${summary.failed} failed</span><span class="count unverified">${summary.unverified} couldn't be verified</span></div>
</section>
${result.criteria.map(criterionCard).join('\n')}
<footer>Verified browser checks require structural and screenshot evidence. Verified API checks require recorded HTTP assertions and an independent review of criterion coverage. API attempts are not automatically retried, to avoid repeating test writes. Text from the app appears as recorded and was treated as evidence only.</footer>
</main>
<script>${script}</script>
</body>
</html>
`;
}
