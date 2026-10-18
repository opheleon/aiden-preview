import { ChevronRight } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import type { Product } from '../../../../packages/contracts/src/index';
import type { DeliveryAttention } from '../renderer/delivery-attention';
import type { FeatureProgress } from '../renderer/delivery-progress';
import { AttentionBadge } from './DeliveryAttention';
import { InfoTip, insideInfoTip } from './InfoTip';

/** The one word that says where a feature stands, with the same tone as a requirement chip. */
function FeatureChip({
  item,
  focus,
}: {
  item: FeatureProgress;
  focus: string | undefined;
}): JSX.Element {
  const { feature, complete, blocked, waitingOn } = item;
  const current = feature.id === focus;
  return (
    <span className={`chip chip--${complete ? 'verified' : current ? 'pm' : 'neutral'}`}>
      {complete
        ? 'Complete'
        : blocked
          ? 'Blocked by a decision'
          : current
            ? 'Current focus'
            : waitingOn.length
              ? 'Waiting on prerequisites'
              : 'Up next'}
    </span>
  );
}

/**
 * One feature of the delivery plan: a collapsible row with its title and one chip. The outcome,
 * rationale, and test plan sit behind an (i) button; opening the row lists its requirements and
 * what it depends on.
 */
export function FeatureSection({
  item,
  product,
  focus,
  attention,
  children,
}: {
  item: FeatureProgress;
  product: Product;
  focus: string | undefined;
  attention: DeliveryAttention | undefined;
  children: ReactNode;
}): JSX.Element {
  const { feature, done, total, waitingOn } = item;
  return (
    <section
      className="delivery-feature"
      id={`feature-${feature.id}`}
      key={feature.id}
      aria-label={feature.title}
    >
      <details className="feature-details">
        <summary
          className="feature-summary"
          title={`${done} of ${total} requirements complete`}
          onClick={(event) => {
            if (insideInfoTip(event.target)) event.preventDefault();
          }}
        >
          <ChevronRight className="feature-chevron" size={20} aria-hidden="true" />
          <span className="feature-heading">
            <h3>
              <code className="feature-id">{feature.id}</code> {feature.title}
            </h3>
            <InfoTip label={`About ${feature.id}`}>
              <span>{feature.outcome}</span>
              <span className="row-sub">
                {feature.kind === 'platform' ? 'Shared platform work · ' : ''}
                {feature.rationale}
              </span>
              {(feature.testPlan || feature.kind === 'platform') && (
                <span className="row-sub">
                  Test plan:{' '}
                  {feature.testPlan ??
                    'needed. Define a consumer integration check, expected results, and failure or rollback checks before implementation.'}
                </span>
              )}
            </InfoTip>
          </span>
          {attention ? (
            <AttentionBadge item={attention} />
          ) : (
            <FeatureChip item={item} focus={focus} />
          )}
        </summary>
        <div className="feature-content">
          {feature.dependsOn.length > 0 && (
            <p className="row-sub">
              Depends on:{' '}
              {feature.dependsOn.map((id) => (
                <a key={id} href={`#feature-${id}`}>
                  {product.deliveryPlan!.find((f) => f.id === id)?.title}{' '}
                </a>
              ))}
              {waitingOn.length > 0 && ` · Waiting for ${waitingOn.join(', ')}`}
            </p>
          )}
          <ul className="req-rows">{children}</ul>
        </div>
      </details>
    </section>
  );
}
