import type { JSX } from 'react';

import type { RuntimeModel } from '../../../../packages/contracts/src/api';
import type { RuntimeConfig } from '../../../../packages/contracts/src/index';

/** Select a model's advertised reasoning effort, preserving saved settings during discovery failures. */
export function EffortSelector({
  runtime,
  models,
  onChange,
  disabled,
}: {
  runtime: RuntimeConfig;
  models: RuntimeModel[];
  onChange: (runtime: RuntimeConfig) => void;
  disabled: boolean;
}): JSX.Element {
  const model = models.find((m) => (runtime.model ? m.id === runtime.model : m.isDefault));
  const choices =
    (model ? (model.supportedEfforts ?? []) : undefined) ??
    (runtime.provider === 'claude'
      ? (['low', 'medium', 'high', 'xhigh', 'max'] as const)
      : (['low', 'medium', 'high', 'xhigh'] as const));
  const savedUnavailable = runtime.effort && !choices.includes(runtime.effort);
  return (
    <label>
      Reasoning effort
      <select
        aria-label="Reasoning effort"
        value={runtime.effort ?? ''}
        disabled={disabled}
        onChange={(e) =>
          onChange({ ...runtime, effort: (e.target.value || undefined) as RuntimeConfig['effort'] })
        }
      >
        <option value="">Provider default</option>
        {choices.map((effort) => (
          <option key={effort} value={effort}>
            {effort}
          </option>
        ))}
        {savedUnavailable && (
          <option value={runtime.effort}>
            {runtime.effort} · saved, unavailable for this model
          </option>
        )}
      </select>
      <span className="fine-print">
        Higher effort can take longer. The selected model and effort apply to future runs.
      </span>
      {model?.resolvedModel && <span className="fine-print">Model ID: {model.resolvedModel}</span>}
    </label>
  );
}
