import { RefreshCw, Settings2 } from 'lucide-react';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import type { RuntimeDiagnostic, RuntimeModel } from '../../../../packages/contracts/src/api';
import type { RuntimeConfig } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';

/** Provider controls and callbacks scoped to a project's chosen authentication profile. */
interface RuntimeSettingsProps {
  runtime: RuntimeConfig;
  diagnostics: RuntimeDiagnostic[];
  onChange: (runtime: RuntimeConfig) => void;
  onRefresh: () => Promise<void>;
  onSave?: (() => Promise<void>) | undefined;
  api?: DesktopBridge | undefined;
  disabled?: boolean;
}

/** Reset transient secrets and model requests whenever the provider or authentication mode changes. */
export default function RuntimeSettings(props: RuntimeSettingsProps): JSX.Element {
  return <RuntimeProfile key={`${props.runtime.provider}:${props.runtime.auth}`} {...props} />;
}

/** Manage one authentication profile; stale requests cannot update a replacement profile. */
function RuntimeProfile({
  runtime,
  diagnostics,
  onChange,
  onRefresh,
  onSave,
  api,
  disabled = false,
}: RuntimeSettingsProps): JSX.Element {
  const [key, setKey] = useState('');
  const [models, setModels] = useState<RuntimeModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const status = diagnostics.find((d) => d.provider === runtime.provider);
  const ready =
    !!status?.installed && (runtime.auth === 'subscription' ? status.subscription : status.apiKey);
  const { provider, auth } = runtime;
  /** Load models for this credential profile, ignoring superseded requests and unmounts. */
  const requestModels = useCallback((): Promise<void> => {
    if (!api) return Promise.resolve();
    const request = ++generation.current;
    return api
      .request('models', { runtime: { provider, auth } })
      .then((result) => {
        if (request === generation.current) {
          setModels(result);
          setError('');
        }
      })
      .catch((error: unknown) => {
        if (request === generation.current) {
          setModels([]);
          setError(
            error instanceof Error
              ? error.message
              : 'Could not load models. Retry or enter a model ID.',
          );
        }
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
  }, [api, provider, auth]);
  useEffect(() => {
    if (ready) void requestModels();
    return () => {
      generation.current += 1;
    };
  }, [ready, requestModels]);
  /** Show progress for an explicit refresh while preserving the current selection. */
  async function loadModels(): Promise<void> {
    setLoading(true);
    setError('');
    await requestModels();
  }
  /** Surface an explicit user action’s failure without losing the saved runtime selection. */
  async function action(fn: () => Promise<void>) {
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection operation failed.');
    }
  }
  return (
    <section className="card runtime-card">
      <div className="card-heading">
        <div className="section-icon">
          <Settings2 size={19} />
        </div>
        <div>
          <h2>Model runtime</h2>
          <p>Provider, authentication, and model for this project.</p>
        </div>
      </div>
      <AuthenticationControls
        runtime={runtime}
        onChange={onChange}
        disabled={disabled}
        status={status}
        secret={key}
        setSecret={setKey}
        api={api}
        onRefresh={onRefresh}
        loadModels={loadModels}
        action={action}
        setMessage={setMessage}
      />
      <button
        className="text-button"
        disabled={loading}
        onClick={() =>
          void action(async () => {
            await onRefresh();
            await loadModels();
          })
        }
      >
        <RefreshCw size={13} />
        {loading ? 'Loading models…' : 'Check connection'}
      </button>
      <div className={`connection ${ready ? 'ready' : ''}`}>
        <span />
        {ready
          ? `${runtime.auth === 'subscription' ? 'Subscription' : 'API key'} credentials available`
          : 'Connection needed'}
      </div>
      <ModelSelector runtime={runtime} models={models} onChange={onChange} disabled={disabled} />
      <p className="fine-print">
        Subscription uses the provider’s currently signed-in account. To switch Claude accounts,
        sign in again through Claude Code. Check connection refreshes status and models without
        changing your selection. Aiden never switches authentication methods automatically. Provider
        limits and charges may apply.
      </p>
      {onSave && (
        <button
          className="primary"
          disabled={disabled}
          onClick={() =>
            void action(async () => {
              await onSave();
              setMessage('Model settings saved for this project.');
            })
          }
        >
          Save model settings
        </button>
      )}
      {error && (
        <p role="alert" className="settings-save-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

/** Display authentication choices and submit credentials only through the trusted desktop bridge. */
function AuthenticationControls({
  runtime,
  onChange,
  disabled,
  status,
  secret,
  setSecret,
  api,
  onRefresh,
  loadModels,
  action,
  setMessage,
}: {
  runtime: RuntimeConfig;
  onChange: RuntimeSettingsProps['onChange'];
  disabled: boolean;
  status: RuntimeDiagnostic | undefined;
  secret: string;
  setSecret: (value: string) => void;
  api: DesktopBridge | undefined;
  onRefresh: () => Promise<void>;
  loadModels: () => Promise<void>;
  action: (fn: () => Promise<void>) => Promise<void>;
  setMessage: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <div className="provider-toggle">
        {(['codex', 'claude'] as const).map((provider) => (
          <button
            key={provider}
            disabled={disabled}
            className={runtime.provider === provider ? 'active' : ''}
            onClick={() => {
              if (provider !== runtime.provider) onChange({ provider, auth: 'subscription' });
            }}
          >
            {provider === 'codex' ? 'Codex' : 'Claude'}
          </button>
        ))}
      </div>
      <label>
        Authentication
        <select
          aria-label="Authentication"
          disabled={disabled}
          value={runtime.auth}
          onChange={(event) =>
            onChange({ ...runtime, auth: event.target.value as RuntimeConfig['auth'] })
          }
        >
          <option value="subscription">Existing subscription</option>
          <option value="apiKey">API key · usage billed by provider</option>
        </select>
      </label>
      {runtime.auth === 'apiKey' ? (
        <>
          <label>
            API key
            <input
              aria-label="API key"
              type="password"
              autoComplete="off"
              placeholder="Stored in memory for this session"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={!secret.trim() || !api}
            onClick={() =>
              void action(async () => {
                await api!.request('setKey', { provider: runtime.provider, key: secret });
                setSecret('');
                await onRefresh();
                await loadModels();
                setMessage('API key is available for this app session.');
              })
            }
          >
            Use API key
          </button>
        </>
      ) : runtime.provider === 'claude' ? (
        <div aria-live="polite" data-testid="claude-connection">
          <p>{status?.message ?? 'Checking Claude subscription sign-in…'}</p>
          {status?.subscriptionState === 'sign_in_required' && (
            <code>claude auth login --claudeai</code>
          )}
        </div>
      ) : (
        <button
          className="secondary"
          onClick={() =>
            void action(async () => {
              await api?.request('login', { provider: 'codex' });
              setMessage('Complete browser sign-in, then check connection.');
            })
          }
        >
          Sign in with Codex
        </button>
      )}
    </>
  );
}

/** Keep saved custom model IDs selectable even when discovery is unavailable. */
function ModelSelector({
  runtime,
  models,
  onChange,
  disabled,
}: {
  runtime: RuntimeConfig;
  models: RuntimeModel[];
  onChange: RuntimeSettingsProps['onChange'];
  disabled: boolean;
}): JSX.Element {
  const selected = runtime.model ?? '';
  const custom = !!selected && !models.some((model) => model.id === selected);
  return (
    <>
      <label>
        Model
        <select
          aria-label="Model"
          disabled={disabled}
          value={selected}
          onChange={(event) => onChange({ ...runtime, model: event.target.value || undefined })}
        >
          <option value="">
            Provider default
            {models.find((model) => model.isDefault)
              ? ` · ${models.find((model) => model.isDefault)!.label}`
              : ''}
          </option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
          {custom && <option value={selected}>{selected} · saved/custom</option>}
        </select>
      </label>
      <details>
        <summary>Enter a model ID</summary>
        <label>
          Model ID
          <input
            aria-label="Model ID"
            disabled={disabled}
            placeholder="Provider default"
            value={selected}
            onChange={(e) => onChange({ ...runtime, model: e.target.value.trim() || undefined })}
          />
        </label>
      </details>
    </>
  );
}
