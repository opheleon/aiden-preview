import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Istanbul's summary metrics count executable units after source-map remapping. */
interface Metric {
  total: number;
  covered: number;
  pct: number;
}
/** Coverage summary for one handwritten runtime source file. */
interface FileCoverage {
  lines: Metric;
  statements: Metric;
  functions: Metric;
  branches: Metric;
}
const summary = JSON.parse(
  await readFile('coverage/backend/coverage-summary.json', 'utf8'),
) as Record<string, FileCoverage>;
const critical =
  /^(packages\/(tools\/src\/|contracts\/src\/|integrations\/src\/(credentials|oauth|tool-policy)|core\/src\/(storage|engine|report-workflow|report-analysis|clarification|ask-why|confirmations|run-lifecycle|baseline|activity|calls|understanding|triage|look|verification-settings|estimation-workflow|estimation-history|estimation-stages|history-normalization|estimate-overrides|model-stage)))/;
const floors = { lines: 90, statements: 90, functions: 90, branches: 85 } as const;
const errors: string[] = [];
let checked = 0;
for (const [file, coverage] of Object.entries(summary)) {
  const relative = path.relative(process.cwd(), file).replaceAll(path.sep, '/');
  if (!critical.test(relative)) continue;
  checked++;
  for (const metric of Object.keys(floors) as (keyof typeof floors)[]) {
    if (coverage[metric].total && coverage[metric].pct < floors[metric])
      errors.push(`${relative}: ${metric} ${coverage[metric].pct}% < ${floors[metric]}%`);
  }
}
if (!checked) errors.push('No critical source files found in the coverage summary.');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
