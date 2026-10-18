import { type JSX, useEffect, useRef, useState } from 'react';

import type { VerifyMethod } from '../../../../packages/contracts/src/guide';
import type { Guide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import {
  type VerificationDraft,
  verificationDraft,
  verificationUpdate,
} from '../renderer/verification-config';
import { phoneVerificationVisible } from '../renderer/verification-features';
import { PhoneFields } from './PhoneFields';
import { VerificationAuthFields } from './VerificationAuthFields';
import { VerificationCredentialStorage } from './VerificationCredentialStorage';

const methods: { id: VerifyMethod; label: string; detail: string }[] = [
  { id: 'code', label: 'Connect the code', detail: 'Check the code in a project folder' },
  { id: 'web', label: 'Web app', detail: 'Use the app in a browser' },
  { id: 'api', label: 'API', detail: 'Check your endpoints' },
  { id: 'phone', label: 'iPhone app', detail: 'Open and control the installed app' },
  { id: 'manual', label: "I'll check it myself", detail: 'Use a manual test list' },
];

/** Shared setup fields; only app targets need a separate access check before confirmation. */
type SetupProps = {
  workspace: Workspace;
  guide: Guide;
  initialMethod?: VerifyMethod;
  initialUrl?: string;
  singleStep?: boolean;
  onSaved?: () => void;
};

/** Map a method to its editable surface selection. */
function selection(
  draft: VerificationDraft,
  code: boolean,
  manual: boolean,
): Record<VerifyMethod, boolean> {
  return { code, web: draft.browser, api: draft.api, phone: draft.phone, manual };
}

/** Load saved choices once while keeping edits local to this setup card. */
function useVerificationChoices({ workspace, initialMethod, initialUrl }: SetupProps) {
  const [draft, setDraft] = useState(verificationDraft);
  const [code, setCode] = useState(
    () => workspace.project.repositories.length > 0 || initialMethod === 'code',
  );
  const [manual, setManual] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const projectId = workspace.project.id;
  const call = workspace.call;
  useEffect(() => {
    let closed = false;
    void call('verificationSettings', { projectId })
      .then((saved) => {
        if (closed) return;
        const next = verificationDraft(saved);
        setDraft({
          ...next,
          browser: next.browser || initialMethod === 'web',
          api: next.api || initialMethod === 'api',
          phone: phoneVerificationVisible() && (next.phone || initialMethod === 'phone'),
          ...(initialUrl && initialMethod === 'web' ? { url: initialUrl } : {}),
          ...(initialUrl && initialMethod === 'api' ? { apiUrl: initialUrl } : {}),
        });
        setManual(!!saved.manual || initialMethod === 'manual');
        setLoaded(true);
      })
      .catch(() => {
        if (!closed) setError('Could not load setup. Close this chat and try again.');
      });
    return () => {
      closed = true;
    };
  }, [call, projectId, initialMethod, initialUrl]);
  return { draft, setDraft, code, setCode, manual, setManual, loaded, error, setError };
}

/** Stage selections locally, validating connected targets before saving the confirmed configuration. */
function useVerificationSetup(props: SetupProps) {
  const { workspace, guide } = props;
  const { draft, setDraft, code, setCode, manual, setManual, loaded, error, setError } =
    useVerificationChoices(props);
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState('');
  const [note, setNote] = useState('');
  const projectId = workspace.project.id;
  const selected = selection(draft, code, manual);
  const needsAccess = draft.browser || draft.api || draft.phone;
  const confirmation = needsAccess ? 'I checked access and confirmed' : 'I confirmed';
  const identity = JSON.stringify({
    draft,
    code,
    manual,
    repositories: workspace.project.repositories,
  });
  /** Clear transient evidence whenever a field or selection changes. */
  function patch(update: Partial<VerificationDraft>): void {
    setDraft((current) => ({ ...current, ...update }));
    setChecked('');
    setNote('');
    setError('');
  }
  /** Select any combination; unchecking a surface stages its removal until confirmation. */
  function toggle(method: VerifyMethod, value: boolean): void {
    setChecked('');
    setNote('');
    setError('');
    if (method === 'code') setCode(value);
    else if (method === 'manual') setManual(value);
    else patch({ [method === 'web' ? 'browser' : method]: value });
  }
  const canSave = props.singleStep || !needsAccess || checked === identity;
  /** Validate the local folder and probe app targets, then optionally commit the selection. */
  async function check(save: boolean): Promise<void> {
    if (pending || (save && !canSave)) return;
    setPending(true);
    setError('');
    setNote('');
    try {
      if (!Object.values(selected).some(Boolean))
        throw new Error('Choose at least one way to check the work.');
      if (code && !workspace.project.repositories.length)
        throw new Error('Choose a folder with a Git repository, or uncheck Connect the code.');
      const update = { ...verificationUpdate(draft), manual };
      const result = await workspace.call('configureGuideVerification', {
        projectId,
        update,
        save,
        ...(code ? { code: workspace.project } : {}),
      });
      setChecked(identity);
      setNote(result.message);
      if (save) {
        // Drop submitted secrets immediately, even if the following chat reply fails.
        setDraft(clearSubmittedSecrets);
        const saved = workspace.projects.find((project) => project.id === projectId);
        if (
          code &&
          JSON.stringify(saved?.repositories) !== JSON.stringify(workspace.project.repositories)
        )
          await workspace.start();
        props.onSaved?.();
        await guide.ask(
          confirmation +
            ' these verification methods: ' +
            methods
              .filter((method) => selected[method.id])
              .map((method) => method.label)
              .join(', ') +
            '.',
        );
      }
    } catch (failure) {
      setChecked('');
      setError(failure instanceof Error ? failure.message : 'Could not check access. Try again.');
    } finally {
      setPending(false);
    }
  }
  return {
    draft,
    selected,
    loaded,
    pending,
    ready: !needsAccess || checked === identity,
    needsAccess,
    note: checked === identity ? note : '',
    error,
    patch,
    toggle,
    check,
  };
}

/** A plain checklist with direct confirmation for local code or manual testing. */
export function GuideVerificationSetup(props: SetupProps): JSX.Element {
  const setup = useVerificationSetup(props);
  const { workspace, guide } = props;
  const form = useRef<HTMLDivElement>(null);
  const requestedReady =
    !!props.initialMethod && setup.loaded && setup.selected[props.initialMethod];
  useEffect(() => {
    if (!requestedReady) return;
    const target = form.current?.querySelector<HTMLInputElement>(
      '[data-guide-entry-target] input[type="url"]',
    );
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
  }, [requestedReady, props.initialMethod]);
  return (
    <div ref={form} className="guide-card guide-verification">
      <fieldset
        className="guide-method-list"
        disabled={!setup.loaded || setup.pending || guide.thinking}
      >
        <legend>How should Aiden check the work?</legend>
        {methods
          .filter((method) => method.id !== 'phone' || phoneVerificationVisible())
          .map((method) => (
            <div
              className="guide-method-option"
              key={method.id}
              data-guide-entry-target={props.initialMethod === method.id ? '' : undefined}
            >
              <label className="guide-method-choice" aria-label={method.label}>
                <input
                  type="checkbox"
                  checked={setup.selected[method.id]}
                  disabled={
                    method.id === 'code' &&
                    !!workspace.projects.find((project) => project.id === workspace.project.id)
                      ?.repositories.length
                  }
                  onChange={(event) => setup.toggle(method.id, event.target.checked)}
                />
                <span>
                  <b>{method.label}</b>
                  <small>{method.detail}</small>
                </span>
              </label>
              {setup.selected[method.id] && (
                <MethodFields
                  method={method.id}
                  workspace={workspace}
                  draft={setup.draft}
                  patch={setup.patch}
                />
              )}
            </div>
          ))}
        <VerificationCredentialStorage value={setup.draft} patch={setup.patch} />
        {props.singleStep && (
          <details className="guide-automatic-checks">
            <summary>Automatic checks</summary>
            <label>
              When to verify
              <select
                value={setup.draft.trigger}
                onChange={(event) =>
                  setup.patch({
                    trigger: event.target.value as VerificationDraft['trigger'],
                  })
                }
              >
                <option value="manual">Only when I run a check</option>
                <option value="after_assessment">After every successful code assessment</option>
              </select>
            </label>
            <p className="guide-card-note">
              Automatic checks use your selected model allowance while Aiden is open. Keep the test
              app available.{' '}
              {setup.needsAccess
                ? 'Saving checks access only.'
                : 'Saving updates your testing settings.'}
            </p>
          </details>
        )}
      </fieldset>
      <p className="guide-card-note">
        Select all that apply.
        {setup.needsAccess &&
          ' We’ll check access before saving. Access checks do not confirm that the requirements work.'}
      </p>
      {setup.note && <p role="status">{setup.note}</p>}
      {setup.error && <p role="alert">{setup.error}</p>}
      <VerificationActions props={props} setup={setup} />
    </div>
  );
}

/** Reveal only the fields belonging to selected methods, reusing the established phone setup controls. */
function MethodFields({
  method,
  workspace,
  draft,
  patch,
}: {
  method: VerifyMethod;
  workspace: Workspace;
  draft: VerificationDraft;
  patch: (update: Partial<VerificationDraft>) => void;
}): JSX.Element | null {
  if (method === 'phone')
    return (
      <div className="guide-method-fields">
        <PhoneFields value={draft} patch={patch} api={window.aiden} />
      </div>
    );
  if (method === 'manual') return null;
  if (method === 'code')
    return (
      <div className="guide-method-fields">
        <p>
          {workspace.project.repositories.length
            ? `Found ${workspace.project.repositories.length} ${workspace.project.repositories.length === 1 ? 'repository' : 'repositories'}.`
            : 'Choose the folder containing your code. Aiden will check for Git repositories.'}
        </p>
        <button
          disabled={workspace.scanning || workspace.busy}
          onClick={() => void workspace.scanProjectFolder(true)}
        >
          {workspace.scanning ? 'Checking the folder…' : 'Choose the folder'}
        </button>
      </div>
    );
  return (
    <div className="guide-method-fields">
      <label>
        {method === 'web' ? 'Where does the app run?' : 'API base URL'}
        <input
          type="url"
          value={method === 'web' ? draft.url : draft.apiUrl}
          placeholder={method === 'web' ? 'http://localhost:3000' : 'http://localhost:8080/api'}
          onChange={(event) =>
            patch(
              method === 'web'
                ? { url: event.target.value }
                : { apiUrl: event.target.value, writes: false },
            )
          }
        />
      </label>
      <VerificationAuthFields surface={method} value={draft} patch={patch} />
      {method === 'api' && (
        <label className="guide-checkbox">
          <input
            type="checkbox"
            checked={draft.writes}
            onChange={(event) => patch({ writes: event.target.checked })}
          />
          Allow writes to this disposable test API
        </label>
      )}
    </div>
  );
}

/** Retain availability flags while dropping submitted credential values from the form. */
function clearSubmittedSecrets(current: VerificationDraft): VerificationDraft {
  return {
    ...current,
    webCredentialsConfigured: current.webCredentialsConfigured || !!current.password,
    apiKeyConfigured: current.apiKeyConfigured || !!current.apiKey,
    username: '',
    password: '',
    apiKey: '',
  };
}

/** Offer one checked save for project edits, retaining the initial setup confirmation flow. */
function VerificationActions({
  props,
  setup,
}: {
  props: SetupProps;
  setup: ReturnType<typeof useVerificationSetup>;
}): JSX.Element {
  const { workspace, guide } = props;
  const unavailable =
    !setup.loaded ||
    setup.pending ||
    guide.thinking ||
    (setup.selected.code && !workspace.project.repositories.length) ||
    !Object.values(setup.selected).some(Boolean);
  return (
    <div className="guide-card-actions">
      {setup.needsAccess && !props.singleStep && (
        <button disabled={unavailable} onClick={() => void setup.check(false)}>
          {setup.pending ? 'Checking access…' : 'Check access'}
        </button>
      )}
      <button
        className="primary"
        disabled={unavailable || (!props.singleStep && !setup.ready) || workspace.busy}
        onClick={() => void setup.check(true)}
      >
        {props.singleStep ? saveLabel(setup.needsAccess, setup.pending) : 'Confirm setup'}
      </button>
    </div>
  );
}

/** Name a settings save by whether it also has an app connection to check. */
function saveLabel(needsAccess: boolean, pending: boolean): string {
  if (pending) return needsAccess ? 'Checking access…' : 'Saving…';
  return needsAccess ? 'Check access & save' : 'Save settings';
}
