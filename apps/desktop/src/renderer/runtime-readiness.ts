import type { RuntimeDiagnostic } from '../../../../packages/contracts/src/api';
import type { RuntimeConfig } from '../../../../packages/contracts/src/index';

/** The provider's name as people see it in the app. */
export function providerName(provider: RuntimeConfig['provider']): string {
  return provider === 'claude' ? 'Claude' : 'Codex';
}

/**
 * Whether the selected provider can run with the selected billing mode, or undefined while its
 * diagnostics have not loaded. Subscription and API-key readiness are never mixed, so a ready API
 * key never counts for a project set to use a subscription.
 * Example: Claude installed and signed in with a subscription is ready for auth 'subscription'.
 */
export function runtimeReady(
  diagnostics: RuntimeDiagnostic[],
  runtime: Pick<RuntimeConfig, 'provider' | 'auth'>,
): boolean | undefined {
  const status = diagnostics.find((d) => d.provider === runtime.provider);
  if (!status) return undefined;
  return (
    status.installed && (runtime.auth === 'subscription' ? status.subscription : status.apiKey)
  );
}
