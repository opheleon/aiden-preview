import { X } from 'lucide-react';
import { type JSX, useEffect, useRef, useState } from 'react';

import type {
  CriterionResult,
  VerificationAttempt,
} from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import { useVerificationMedia } from '../hooks/useVerificationMedia';
import { browserLabel } from '../renderer/requirement-status';

const verdictWords: Record<VerificationAttempt['verdict'], string> = {
  pass: 'Passed',
  fail: 'Failed',
  unverified: "Couldn't verify",
};

const verdictTones: Record<CriterionResult['verdict'], string> = {
  pass: 'verified',
  fail: 'incomplete',
  unverified: 'neutral',
};

/** Format a recording offset as m:ss, matching the timestamps in the full HTML report. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Where the pop-up reads the browser check's saved recordings and screenshots. */
interface EvidenceSource {
  api: DesktopBridge | undefined;
  projectId: string;
  runId: string;
}

/**
 * Show one requirement's browser check in a pop-up: the recording, what Aiden expected and saw,
 * the proof screenshot, and each step it took. It opens on the attempt that decided the verdict;
 * with a retry, both attempts can be watched. Escape or Close dismisses it.
 */
export function BrowserEvidence({
  api,
  projectId,
  runId,
  criterion,
  onClose,
}: EvidenceSource & { criterion: CriterionResult; onClose: () => void }): JSX.Element {
  const [selected, setSelected] = useState(
    () => criterion.decisiveAttempt ?? criterion.attempts.at(-1)?.attempt ?? 1,
  );
  const [error, setError] = useState('');
  const attempt =
    criterion.attempts.find((item) => item.attempt === selected) ?? criterion.attempts[0];
  useEffect(() => {
    /** Close on Escape like the other Aiden dialogs' Close button. */
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay">
      <section
        className="modal browser-evidence card"
        role="dialog"
        aria-modal="true"
        aria-label={criterion.method === 'api' ? 'API check' : 'Browser check'}
      >
        <div className="card-heading">
          <div>
            <p className="eyebrow">
              {criterion.requirementId}
              {criterion.edgeCaseId ? ` edge case ${criterion.edgeCaseId}` : ''} ·{' '}
              {criterion.method === 'api' ? 'API check' : 'Browser check'}
            </p>
            <h2>{criterion.criterion}</h2>
          </div>
          <button className="icon-button" aria-label="Close browser check" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <span
          className={`project-status-badge project-status-badge--${verdictTones[criterion.verdict]}`}
        >
          {browserLabel(criterion)}
        </span>
        {criterion.attempts.length > 1 && (
          <div className="browser-evidence-attempts" role="group" aria-label="Attempts">
            {criterion.attempts.map((item) => (
              <button
                key={item.attempt}
                aria-pressed={item.attempt === attempt?.attempt}
                onClick={() => setSelected(item.attempt)}
              >
                Attempt {item.attempt} · {verdictWords[item.verdict]}
                {item.attempt === criterion.decisiveAttempt ? ' (decided the result)' : ''}
              </button>
            ))}
          </div>
        )}
        {attempt ? (
          <AttemptEvidence
            key={attempt.attempt}
            api={api}
            projectId={projectId}
            runId={runId}
            attempt={attempt}
            method={criterion.method ?? 'app'}
          />
        ) : (
          <p>{criterion.explanation}</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="product-actions browser-evidence-actions">
          <button
            className="secondary"
            onClick={() =>
              void api
                ?.openVerificationReport({ projectId, runId })
                .catch(() => setError('Could not open the full report.'))
            }
          >
            Open full report
          </button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

/** One attempt's recording, findings, proof screenshot, and steps; a step's time seeks the video. */
function AttemptEvidence({
  api,
  projectId,
  runId,
  attempt,
  method,
}: EvidenceSource & { attempt: VerificationAttempt; method: 'app' | 'api' }): JSX.Element {
  const checkKind = method === 'api' ? 'API' : 'Page';
  const video = useRef<HTMLVideoElement>(null);
  const recording = useVerificationMedia(api, projectId, runId, attempt.video);
  const check = attempt.proof;
  const proof = useVerificationMedia(api, projectId, runId, check?.screenshot ?? null);
  /** Move the recording to the moment a step or page check happened. */
  const seek = (ms: number) => {
    if (video.current) video.current.currentTime = ms / 1000;
  };
  return (
    <>
      <p className="browser-evidence-explanation">{attempt.explanation}</p>
      <figure className="browser-evidence-video">
        {recording.url ? (
          <video
            ref={video}
            src={recording.url}
            controls
            muted
            aria-label={`Recording of attempt ${attempt.attempt}`}
          />
        ) : (
          <p className="product-muted">{recording.error || 'Loading recording…'}</p>
        )}
        {check && (
          <figcaption>
            <button className="text-button" onClick={() => seek(check.atMs)}>
              Jump to the {checkKind.toLowerCase()} check at {clock(check.atMs)}
            </button>
          </figcaption>
        )}
      </figure>
      {(attempt.expected || attempt.observed) && (
        <dl className="browser-evidence-facts">
          <dt>Expected</dt>
          <dd>{attempt.expected ?? 'Not recorded'}</dd>
          <dt>Observed</dt>
          <dd>{attempt.observed ?? 'Not recorded'}</dd>
        </dl>
      )}
      {check && (
        <figure className="browser-evidence-proof">
          {proof.url ? (
            <img src={proof.url} alt={`${checkKind} check screenshot: ${check.actual}`} />
          ) : (
            <p className="product-muted">{proof.error || 'Loading screenshot…'}</p>
          )}
          <figcaption>
            {checkKind} check {check.passed ? 'passed' : 'failed'}: {check.actual}
          </figcaption>
        </figure>
      )}
      <h3>Steps</h3>
      <ol className="browser-evidence-steps">
        {attempt.steps.map((step) => (
          <li key={step.index}>
            <button
              className="browser-evidence-time"
              aria-label={`Jump to step ${step.index} at ${clock(step.atMs)}`}
              onClick={() => seek(step.atMs)}
            >
              {clock(step.atMs)}
            </button>
            <div>
              <strong>{step.action}</strong>
              <p>{step.result}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
