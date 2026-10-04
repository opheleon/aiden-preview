import type { Engine } from './engine.js';
/** Dependencies shared by report and estimation workflows; no lifecycle ownership. */
export type WorkflowContext = Pick<
  Engine,
  'store' | 'runtime' | 'emit' | 'integrations' | 'getReport' | 'getEstimate'
>;
