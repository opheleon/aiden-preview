import type { JSX } from 'react';

import type { Guide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import type { ProjectChatEntry } from '../renderer/project-chat-entry';
import { GuideVerificationSetup } from './GuideVerificationSetup';
import { useProjectGuide } from './ProjectGuide';

/** Show the one action requested from a project page, using the same trusted setup controls. */
export function ProjectChatAction({
  entry,
  workspace,
  guide,
  onDone,
}: {
  entry: ProjectChatEntry;
  workspace: Workspace;
  guide: Guide;
  onDone: () => void;
}): JSX.Element | null {
  const { open, close } = useProjectGuide();
  /** Keep advanced controls reachable until each has an equivalent conversational setup path. */
  function advanced(): void {
    close();
    workspace.setSettingsTab('project');
    workspace.setArea('settings');
  }
  if (entry.type === 'verification')
    return (
      <section aria-label="Edit project verification" className="project-chat-action">
        <p className="guide-context">Project connections · Verification</p>
        <GuideVerificationSetup
          workspace={workspace}
          guide={guide}
          {...(entry.method ? { initialMethod: entry.method } : {})}
          singleStep
          onSaved={onDone}
        />
      </section>
    );
  if (entry.type === 'connections')
    return (
      <section aria-label="Manage project connections" className="project-chat-action">
        <p>What would you like to change for this project?</p>
        <div className="guide-connection-actions">
          <button onClick={() => open({ type: 'verification', method: 'web' })}>
            Web app and test account
          </button>
          <button onClick={() => open({ type: 'verification', method: 'api' })}>API access</button>
          <button onClick={() => open({ type: 'verification' })}>Check methods</button>
          <button onClick={advanced}>Advanced project settings</button>
        </div>
        <p className="guide-card-note">
          Manage code folders, branches, ticket trackers, schedules, and context access in advanced
          project settings.
        </p>
      </section>
    );
  if (entry.type === 'run') return null;
  if (entry.type === 'requirement' || entry.type === 'finding') {
    const requirement = workspace.baseline?.product.requirements.find(
      (item) => item.id === entry.requirementId,
    );
    return (
      <section className="project-chat-action" aria-label="Selected requirement">
        <p className="guide-context">Scope · {entry.requirementId}</p>
        <p>{requirement?.text ?? 'This requirement is no longer in the current scope.'}</p>
        {entry.type === 'finding' ? (
          <>
            <p>Finding: {entry.title}</p>
            <p>Ask about this finding below, or update the test setup.</p>
            <button onClick={() => open({ type: 'verification' })}>Change test setup</button>
          </>
        ) : (
          requirement && (
            <p>What should change? Describe it below so Aiden can clarify it with you.</p>
          )
        )}
        <button className="text-button" onClick={onDone}>
          Clear context
        </button>
      </section>
    );
  }
  return (
    <section className="project-chat-action" aria-label="Change project scope">
      <p className="guide-context">
        Scope · {entry.type === 'goal' ? 'Project goal' : 'Requirements'}
      </p>
      <p>
        What would you like to change? Aiden will clarify the changes before you confirm the
        requirements.
      </p>
      <button className="text-button" onClick={onDone}>
        Clear context
      </button>
    </section>
  );
}
