import type { JSX } from 'react';

import type { CodingJob, Product, Report } from '../../../../packages/contracts/src/index';
import type { Workspace } from '../hooks/useWorkspace';
import type { Check, ItemState } from '../renderer/requirement-status';
import { DeliveryProgress } from './DeliveryProgress';

/** Show delivery evidence when available, or honest app-only progress before a code assessment. */
export function ProjectProgress({
  workspace,
  product,
  report,
  states,
  check,
  job,
}: {
  workspace: Workspace;
  product: Product | undefined;
  report: Report | undefined;
  states: Map<string, ItemState>;
  check: Check | null;
  job: CodingJob | undefined;
}): JSX.Element | null {
  if (!product) return null;
  return report ? (
    <DeliveryProgress
      workspace={workspace}
      product={product}
      report={report}
      states={states}
      job={job}
    />
  ) : (
    <AppProgress workspace={workspace} product={product} check={check} />
  );
}

/** Keep app-only progress visible while explaining that estimates need the code. */
function AppProgress({
  workspace,
  product,
  check,
}: {
  workspace: Workspace;
  product: Product;
  check: Check | null;
}): JSX.Element {
  const hasCode = workspace.project.repositories.length > 0;
  const total = check?.result.criteria.length ?? 0;
  const passed =
    check?.result.criteria.filter((criterion) => criterion.verdict === 'pass').length ?? 0;
  return (
    <div className="delivery-progress">
      <h2 className="card-label">Verification progress</h2>
      {total > 0 ? (
        <>
          <p>
            {passed} of {total} checks passed
          </p>
          <progress
            aria-label="App checks passed, not percentage of delivery"
            max={total}
            value={passed}
          />
        </>
      ) : (
        <p>Progress will appear after the first check.</p>
      )}
      <p className="row-sub">
        App checks show observed behavior. They do not measure remaining development effort.
      </p>
      <p>
        <strong>Remaining effort:</strong>{' '}
        {hasCode
          ? 'A code-based estimate is available after the first code check.'
          : 'Connect your code to estimate the remaining work.'}
      </p>
      <p>
        <strong>Agreed timing:</strong>{' '}
        {product.milestones.length ? product.milestones.join(' · ') : 'No target agreed yet.'}
      </p>
    </div>
  );
}
