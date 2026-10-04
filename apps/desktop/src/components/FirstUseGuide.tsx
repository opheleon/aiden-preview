import { X } from 'lucide-react';
import { type JSX, useEffect, useRef, useState } from 'react';

import brandMark from '../assets/brand-mark.svg';
import type { useFirstUse } from '../hooks/useFirstUse';

/** A small, usable introduction; the full workflow guide extends these steps in the next delivery slice. */
const steps = [
  {
    title: 'Meet Aiden',
    summary: 'Turn an idea into a delivery plan you can follow.',
    points: [
      'You set the scope, answer decisions, and accept the outcome.',
      'Aiden organizes requirements, checks evidence, and surfaces what needs you.',
    ],
    detail:
      'You stay in control of your projects. Reading this guide starts no model work and changes no provider or tracker settings.',
  },
  {
    title: 'Connect your model',
    summary: 'Choose the account and model Aiden should use.',
    points: [
      'Open Settings → Model to choose Codex or Claude.',
      'Install the provider runtime and sign in with your existing account.',
    ],
    detail:
      'Use the provider setup instructions in Model settings. Keep your intended subscription or API-key billing choice. Aiden does not have a separate account sign-in.',
  },
  {
    title: 'Ready to begin',
    summary: 'Start with one clear goal and the repository that contains the work.',
    points: [
      'Create a project, describe what you want, and choose its folder.',
      'Review the requirements and answer questions when Aiden needs a decision.',
    ],
    detail:
      'Select Got it to remember that you have read this guide in this local workspace. Later or Escape leaves it incomplete so it returns on the next app launch.',
  },
];

/** Accessible native modal with contained focus, step announcements and a durable explicit finish action. */
export function FirstUseGuide({ guide }: { guide: ReturnType<typeof useFirstUse> }): JSX.Element {
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = steps[step]!;
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    heading.current?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected)
        previous.focus();
      else document.querySelector<HTMLButtonElement>('[data-guide-trigger]')?.focus();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  return (
    <dialog
      ref={dialog}
      className="first-use-guide"
      aria-labelledby="guide-title"
      aria-describedby="guide-summary"
      onCancel={(event) => {
        event.preventDefault();
        guide.dismiss();
      }}
    >
      <header className="guide-header">
        <div>
          <img src={brandMark} alt="" />
          <span>Getting started with Aiden</span>
        </div>
        <button
          className="icon-button"
          aria-label="Close guide for now"
          disabled={guide.saving}
          onClick={guide.dismiss}
        >
          <X size={18} />
        </button>
      </header>
      <div className="guide-content">
        <p className="guide-progress" aria-live="polite">
          Step {step + 1} of {steps.length}
        </p>
        <h1 id="guide-title" ref={heading} tabIndex={-1}>
          {content.title}
        </h1>
        <p id="guide-summary" className="guide-summary">
          {content.summary}
        </p>
        <ul>
          {content.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <details key={step}>
          <summary>A little more detail</summary>
          <p>{content.detail}</p>
        </details>
        {guide.state.issue && (
          <p className="guide-notice" role="status">
            {guide.state.issue === 'corrupt'
              ? 'The saved guide preference could not be read. Confirm again to repair it.'
              : 'Aiden could not read the guide preference. You can still explore; confirmation will retry saving it.'}
          </p>
        )}
        {guide.error && (
          <p className="guide-error" role="alert">
            {guide.error}
          </p>
        )}
      </div>
      <footer className="guide-footer">
        <button className="text-button" disabled={guide.saving} onClick={guide.dismiss}>
          Later
        </button>
        <div className="button-row">
          {step > 0 && (
            <button className="secondary" disabled={guide.saving} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < steps.length - 1 ? (
            <button className="primary" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button
              className="primary"
              disabled={guide.saving}
              onClick={() => void guide.confirm()}
            >
              {guide.saving ? 'Saving…' : 'Got it'}
            </button>
          )}
        </div>
      </footer>
    </dialog>
  );
}
