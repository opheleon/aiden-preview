import { CheckCircle2, LifeBuoy, MessageCircle, Play } from 'lucide-react';
import type { JSX } from 'react';

import { type GuideWidget, helpLinks } from '../../../../packages/contracts/src/guide';
import type { Guide } from '../hooks/useGuide';
import type { Workspace } from '../hooks/useWorkspace';
import { GuideCodeSetup } from './GuideCodeSetup';
import { GuideVerificationSetup } from './GuideVerificationSetup';
const api = window.aiden;

/** Inline project chat controls and their shared actions. */
type CardProps = {
  workspace: Workspace;
  guide: Guide;
  onHelp: () => void;
  onCompose: (text: string) => void;
};

/** Play back the requirements with one-click confirmation; changes go through the composer. */
function ConfirmRequirements({ workspace, guide, onCompose }: CardProps): JSX.Element {
  const requirements = workspace.baseline?.product.requirements ?? [];
  return (
    <div className="guide-card guide-confirm">
      <ol className="guide-requirements">
        {requirements.map((r) => (
          <li key={r.id}>
            <b>{r.id}</b> {r.text}
          </li>
        ))}
      </ol>
      <div className="guide-card-actions">
        <button className="primary" disabled={guide.thinking} onClick={() => void guide.confirm()}>
          <CheckCircle2 size={14} /> Looks right
        </button>
        <button disabled={guide.thinking} onClick={() => onCompose('Change something: ')}>
          Change something
        </button>
      </div>
    </div>
  );
}

/** Start the first check now, or put it off; the checklist remembers either choice. */
function RunCheck({ workspace, guide }: CardProps): JSX.Element | null {
  return (
    <div className="guide-card-actions">
      <button
        className="primary"
        disabled={workspace.busy || guide.thinking}
        onClick={() => void workspace.lookNow()}
      >
        <Play size={14} /> Run the check now
      </button>
      {!guide.view?.setup.complete && (
        <button
          disabled={workspace.busy || guide.thinking}
          onClick={() => void guide.skip('first-check')}
        >
          Later
        </button>
      )}
    </div>
  );
}

/** Render setup choices as one shared checklist, including older saved single-method cards. */
export function GuideWidgetCard(props: CardProps & { widget: GuideWidget }): JSX.Element | null {
  const { widget } = props;
  switch (widget.type) {
    case 'confirm-requirements':
      return <ConfirmRequirements {...props} />;
    case 'connect-code':
      return <GuideCodeSetup workspace={props.workspace} guide={props.guide} />;
    case 'verify-options':
      return <GuideVerificationSetup {...props} />;
    case 'choose-folder':
      return <GuideVerificationSetup {...props} initialMethod="code" />;
    case 'web-check':
      return (
        <GuideVerificationSetup
          {...props}
          initialMethod="web"
          {...(widget.url ? { initialUrl: widget.url } : {})}
        />
      );
    case 'api-check':
      return (
        <GuideVerificationSetup
          {...props}
          initialMethod="api"
          {...(widget.url ? { initialUrl: widget.url } : {})}
        />
      );
    case 'phone-check':
      return <GuideVerificationSetup {...props} />;
    case 'manual-check':
      return <GuideVerificationSetup {...props} initialMethod="manual" />;
    case 'run-check':
      return <RunCheck {...props} />;
    case 'link':
      return widget.link === 'slack' ? (
        <button className="guide-link" onClick={() => void api?.openExternal(helpLinks.slack)}>
          <MessageCircle size={14} /> Ask in our Slack
        </button>
      ) : (
        <button className="guide-link" onClick={props.onHelp}>
          <LifeBuoy size={14} /> Open Help / Getting started
        </button>
      );
  }
}
