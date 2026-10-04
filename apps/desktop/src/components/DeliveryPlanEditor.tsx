import { type JSX, useState } from 'react';

import type { DeliveryFeature, Product } from '../../../../packages/contracts/src/index';
import { orderedPlan } from '../renderer/delivery-progress';

/** Edit a feature's intent and hard prerequisites; later features cannot become prerequisites. */
function FeatureFields({
  feature,
  earlier,
  onChange,
}: {
  feature: DeliveryFeature;
  earlier: DeliveryFeature[];
  onChange: (patch: Partial<DeliveryFeature>) => void;
}): JSX.Element {
  return (
    <div className="plan-fields">
      <label>
        Feature name
        <input
          maxLength={120}
          aria-label={`Name ${feature.id}`}
          value={feature.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </label>
      <label>
        Usable outcome
        <textarea
          maxLength={600}
          aria-label={`Outcome ${feature.id}`}
          value={feature.outcome}
          onChange={(e) => onChange({ outcome: e.target.value })}
        />
      </label>
      <label>
        Why this order
        <textarea
          maxLength={600}
          aria-label={`Rationale ${feature.id}`}
          value={feature.rationale}
          onChange={(e) => onChange({ rationale: e.target.value })}
        />
      </label>
      <label>
        Test plan
        <textarea
          maxLength={1600}
          aria-label={`Test plan ${feature.id}`}
          value={feature.testPlan ?? ''}
          placeholder="What will be exercised, expected results, and evidence to record. For foundations, include a real consumer and failure or rollback checks."
          onChange={(e) => onChange({ testPlan: e.target.value || undefined })}
        />
      </label>
      <label>
        Type
        <select
          aria-label={`Type ${feature.id}`}
          value={feature.kind}
          onChange={(e) => onChange({ kind: e.target.value as DeliveryFeature['kind'] })}
        >
          <option value="feature">Vertical feature</option>
          <option value="platform">Shared platform work</option>
        </select>
      </label>
      {earlier.length > 0 && (
        <fieldset>
          <legend>Hard prerequisites</legend>
          {earlier.map((f) => (
            <label className="checkbox-row" key={f.id}>
              <input
                type="checkbox"
                checked={feature.dependsOn.includes(f.id)}
                onChange={(e) =>
                  onChange({
                    dependsOn: e.target.checked
                      ? [...feature.dependsOn, f.id]
                      : feature.dependsOn.filter((id) => id !== f.id),
                  })
                }
              />
              {f.title}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** Preview an adjacent reorder; the button is disabled when it would violate a dependency. */
function moved(plan: DeliveryFeature[], index: number, offset: number): DeliveryFeature[] {
  const next = [...plan];
  const item = next.splice(index, 1)[0]!;
  next.splice(index + offset, 0, item);
  return next;
}

/** Optional plan adjustments are saved as a new baseline and immediately checked. */
export function DeliveryPlanEditor({
  product,
  busy,
  onSave,
  onClose,
}: {
  product: Product;
  busy: boolean;
  onSave: (product: Product) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [plan, setPlan] = useState(product.deliveryPlan ?? []);
  const [error, setError] = useState('');
  /** Apply an edit to one feature while retaining stable identities. */
  const change = (id: string, patch: Partial<DeliveryFeature>) =>
    setPlan(plan.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  /** Save only a complete plan; worker validation remains authoritative. */
  const save = async () => {
    if (
      plan.some(
        (f) =>
          !f.requirementIds.length || !f.title.trim() || !f.outcome.trim() || !f.rationale.trim(),
      )
    ) {
      setError('Each feature needs a name, outcome, rationale, and at least one requirement.');
      return;
    }
    if (plan.some((f) => f.kind === 'platform' && !f.testPlan?.trim())) {
      setError(
        'Shared platform work needs a test plan with a consumer, expected results, and failure checks.',
      );
      return;
    }
    try {
      await onSave({ ...product, deliveryPlan: plan });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The plan could not be saved.');
    }
  };
  return (
    <div className="plan-editor">
      <p className="row-sub">
        This is Aiden’s working order. Adjust it when needed; hard prerequisites must stay earlier.
      </p>
      {plan.map((feature, index) => (
        <fieldset key={feature.id}>
          <legend>
            {index + 1}. {feature.title}
          </legend>
          <FeatureFields
            feature={feature}
            earlier={plan.slice(0, index)}
            onChange={(patch) => change(feature.id, patch)}
          />
          <div className="button-row">
            <button
              className="text-button"
              aria-label={`Move ${feature.title} earlier`}
              disabled={index === 0 || !orderedPlan(moved(plan, index, -1))}
              onClick={() => setPlan(moved(plan, index, -1))}
            >
              Move earlier
            </button>
            <button
              className="text-button"
              aria-label={`Move ${feature.title} later`}
              disabled={index === plan.length - 1 || !orderedPlan(moved(plan, index, 1))}
              onClick={() => setPlan(moved(plan, index, 1))}
            >
              Move later
            </button>
            <button
              className="text-button"
              disabled={
                feature.requirementIds.length > 0 ||
                plan.some((f) => f.dependsOn.includes(feature.id))
              }
              onClick={() => setPlan(plan.filter((f) => f.id !== feature.id))}
            >
              Remove empty feature
            </button>
          </div>
        </fieldset>
      ))}
      <button
        className="text-button"
        onClick={() =>
          setPlan([
            ...plan,
            {
              id: `F-${Math.max(0, ...plan.map((f) => Number(f.id.slice(2)))) + 1}`,
              title: 'New feature',
              outcome: '',
              rationale: '',
              kind: 'feature',
              requirementIds: [],
              dependsOn: [],
            },
          ])
        }
      >
        Add feature
      </button>
      <RequirementOwnership product={product} plan={plan} setPlan={setPlan} />
      {error && <p role="alert">{error}</p>}
      <div className="button-row">
        <button className="primary" disabled={busy} onClick={() => void save()}>
          Save plan and check
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Move requirements between vertical features and adjust their implementation order. */
function RequirementOwnership({
  product,
  plan,
  setPlan,
}: {
  product: Product;
  plan: DeliveryFeature[];
  setPlan: (plan: DeliveryFeature[]) => void;
}): JSX.Element {
  /** Replace one feature’s ordered requirement IDs. */
  const change = (id: string, patch: Partial<DeliveryFeature>) =>
    setPlan(plan.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const requirements = plan
    .flatMap((f) => f.requirementIds)
    .map((id) => product.requirements.find((r) => r.id === id)!);
  return (
    <fieldset>
      <legend>Requirement ownership and order</legend>
      {requirements.map((requirement) => {
        const owner = plan.find((f) => f.requirementIds.includes(requirement.id));
        const position = owner?.requirementIds.indexOf(requirement.id) ?? 0;
        return (
          <div className="plan-assignment" key={requirement.id}>
            <label>
              {requirement.id} · {requirement.text}
              <select
                aria-label={`Feature for ${requirement.id}`}
                value={owner?.id ?? ''}
                onChange={(e) =>
                  setPlan(
                    plan.map((f) => ({
                      ...f,
                      requirementIds:
                        f.id === e.target.value
                          ? [...f.requirementIds, requirement.id]
                          : f.requirementIds.filter((id) => id !== requirement.id),
                    })),
                  )
                }
              >
                {plan.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-button"
              aria-label={`Move ${requirement.id} earlier`}
              disabled={!owner || position === 0}
              onClick={() => {
                const ids = [...owner!.requirementIds];
                [ids[position - 1], ids[position]] = [ids[position]!, ids[position - 1]!];
                change(owner!.id, { requirementIds: ids });
              }}
            >
              Earlier within feature
            </button>
          </div>
        );
      })}
    </fieldset>
  );
}
