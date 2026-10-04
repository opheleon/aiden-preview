import { readFileSync } from 'node:fs';

import { ReportSchema } from '../../packages/contracts/src/index';
// Compatibility input: previously recorded provider report on synthetic repositories.
const saved = ReportSchema.parse(
  JSON.parse(readFileSync('examples/reports/codex-live.json', 'utf8')),
);

// Synthetic remote provenance for renderer completion cases; no live remote was contacted.
export const report = {
  ...saved,
  snapshots: saved.snapshots.map((s) => ({
    ...s,
    source: 'remote-default' as const,
    checkedAt: saved.generatedAt,
  })),
};
