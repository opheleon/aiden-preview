import type { Product, Report } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';
import { actionItems, risks } from './action-items';
import { briefState } from './brief-state';
import {
  briefStatus,
  matchingCheck,
  type RequirementFacts,
  requirementFacts,
  requirementState,
} from './requirement-status';

/** Derive one consistent current-baseline view for the overview, work list, and copied update. */
export function briefData(workspace: Workspace): {
  report: Report | undefined;
  product: Product | undefined;
  check: ReturnType<typeof matchingCheck>;
  stateMap: Map<string, ReturnType<typeof requirementState>>;
  actions: ReturnType<typeof actionItems>;
  unverified: ReturnType<typeof risks>;
  state: ReturnType<typeof briefState>;
  status: ReturnType<typeof briefStatus>;
  update: string;
} {
  const { project, baseline, verification, calls, busy, runs } = workspace;
  const report = workspace.report?.baselineId === baseline?.id ? workspace.report : undefined;
  const product = report?.baseline ?? baseline?.product;
  const check = report
    ? matchingCheck(verification, report, runs.find((r) => r.id === report.id)?.createdAt)
    : null;
  const facts = report
    ? requirementFacts(report, check, calls, workspace.confirmed)
    : new Map<string, RequirementFacts>();
  const stateMap = new Map([...facts].map(([id, f]) => [id, requirementState(f)]));
  const actions = actionItems({ report, check, calls, project, confirmed: workspace.confirmed });
  const unverified = report ? risks(report, check) : [];
  const state = briefState({ busy, hasBaseline: !!baseline, hasReport: !!report, runs });
  const status = report
    ? briefStatus([...stateMap.values()], {
        pm: actions.filter((a) => a.role === 'PM').length,
        dev: actions.filter((a) => a.role === 'Dev').length,
      })
    : { headline: state.headline ?? '', lands: state.lands ?? '' };
  const update = [
    status.headline,
    status.lands,
    ...actions.map((a) => `${a.role}: ${a.action}`),
    ...unverified.map((r) => `Risk: ${r.label} ${r.text} (${r.reason})`),
  ].join('\n');
  return { report, product, check, stateMap, actions, unverified, state, status, update };
}
