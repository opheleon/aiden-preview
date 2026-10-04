import { type JSX, useEffect, useRef, useState } from 'react';

import type { Workspace } from '../hooks/useWorkspace';

/** Record an explicit acceptance or closure with a note and a clear explanation of its effect. */
function OutcomeDialog({
  workspace,
  mode,
  dismiss,
}: {
  workspace: Workspace;
  mode: 'accept' | 'close';
  dismiss: () => void;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [evidenceKey] = useState(workspace.project.lifecycle?.evidenceKey ?? '');
  const title = mode === 'accept' ? 'Accept outcome' : 'Close project';
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  /** Keep failures in the dialog so the note survives a stale-evidence or active-operation rejection. */
  async function save(): Promise<void> {
    setSaving(true);
    setError('');
    try {
      const projectId = workspace.project.id;
      const project =
        mode === 'accept'
          ? await workspace.call('acceptOutcome', { projectId, note, evidenceKey })
          : await workspace.call('closeProject', { projectId, note });
      workspace.setProject((current) => (current.id === projectId ? project : current));
      workspace.setProjects((projects) => projects.map((p) => (p.id === projectId ? project : p)));
      dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the project decision.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="outcome-dialog"
      aria-labelledby="outcome-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) dismiss();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="outcome-title">{title}</h2>
        <p>
          {mode === 'accept'
            ? 'Record your decision to accept this outcome. Failed checks, deviations, and unverified work stay visible. This does not merge code or close tracker tickets.'
            : 'Pause automatic checks, delivery monitoring, and ticket syncing. History and evidence stay available. You can reopen the project anytime. External projects and tickets keep their current status.'}
        </p>
        <p>
          {mode === 'accept'
            ? 'Acceptance applies to the current scope and saved checks. New evidence needs a fresh review. Close the project afterward if monitoring is finished.'
            : 'Closing a project does not mark its outcome as accepted or its requirements as verified.'}
        </p>
        <label>
          {mode === 'accept' ? 'Acceptance note' : 'Closing note'}
          <textarea
            required
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              mode === 'accept'
                ? 'What did you review, and which remaining gaps are you accepting?'
                : 'Why are you closing this project?'
            }
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <button type="button" disabled={saving} onClick={dismiss}>
            Cancel
          </button>
          <button className="primary" disabled={saving || !note.trim()}>
            {saving ? 'Saving…' : title}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Keep the person's outcome decision separate from automated progress, with reversible project closure. */
export function ProjectOutcome({ workspace }: { workspace: Workspace }): JSX.Element {
  const [mode, setMode] = useState<'accept' | 'close'>();
  const lifecycle = workspace.project.lifecycle;
  const closed = lifecycle?.status === 'closed';
  const accepted = lifecycle?.acceptanceCurrent;
  /** Reopening restores the existing monitoring configuration without changing the evidence. */
  async function reopen(): Promise<void> {
    const project = await workspace.call('reopenProject', { projectId: workspace.project.id });
    workspace.setProject((current) => (current.id === project.id ? project : current));
    workspace.setProjects((projects) => projects.map((p) => (p.id === project.id ? project : p)));
  }
  return (
    <section className="project-outcome" aria-label="Project outcome">
      <div className="outcome-row">
        <div>
          <strong>
            {closed ? 'Project closed' : accepted ? 'Manually accepted' : 'Accept the outcome'}
          </strong>
          <p>{outcomeMessage(workspace)}</p>
          {closed && accepted && (
            <p>Outcome manually accepted. Check results are preserved below.</p>
          )}
        </div>
        <div className="button-row">
          {closed ? (
            <button onClick={() => void workspace.action(reopen)}>Reopen project</button>
          ) : (
            <>
              <button
                disabled={workspace.busy || !workspace.baseline || !lifecycle}
                onClick={() => setMode('accept')}
              >
                {accepted ? 'Update acceptance' : 'Accept outcome'}
              </button>
              <button disabled={workspace.busy} onClick={() => setMode('close')}>
                Close project
              </button>
            </>
          )}
        </div>
      </div>
      {!!lifecycle?.history.length && (
        <details>
          <summary>Decision history</summary>
          <ol>
            {[...lifecycle.history].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <strong>
                  {entry.action === 'accepted'
                    ? 'Manually accepted'
                    : entry.action === 'closed'
                      ? 'Project closed'
                      : 'Project reopened'}
                </strong>
                {' · '}
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                <p>{entry.note}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
      {mode && (
        <OutcomeDialog workspace={workspace} mode={mode} dismiss={() => setMode(undefined)} />
      )}
    </section>
  );
}

/** Explain the decision state without conflating acceptance, verification, and monitoring. */
function outcomeMessage(workspace: Workspace): string {
  const lifecycle = workspace.project.lifecycle;
  if (lifecycle?.status === 'closed') return 'Monitoring and ticket syncing are paused.';
  if (lifecycle?.acceptanceCurrent)
    return 'Your decision is recorded. Monitoring continues until you close the project.';
  if (lifecycle?.acceptance)
    return 'Scope or evidence changed since acceptance. Review the latest results.';
  return 'When you are satisfied, record your decision here.';
}
