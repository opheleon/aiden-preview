import { ChevronRight, Play } from 'lucide-react';
import type { JSX, MouseEvent, ReactNode } from 'react';

import type { CriterionResult, Report, TriageItem } from '../../../../packages/contracts/src/index';
import type { DeliveryAttention } from '../renderer/delivery-attention';
import { edgeState, type ItemState, plural } from '../renderer/requirement-status';
import { AttentionBadge } from './DeliveryAttention';

type Requirement = Report['baseline']['requirements'][number];
/** Open one cited code excerpt from the accepted report. */
export type OpenEvidence = (assessmentIndex: number, evidenceIndex: number) => void;

/** A status chip in the shared badge style. */
export function Chip({ state }: { state: ItemState }): JSX.Element {
  return <span className={`chip chip--${state.tone}`}>{state.label}</span>;
}

/** Play button for a browser check that has a recording; it never toggles the row. */
export function Watch({
  result,
  label,
  onWatch,
}: {
  result: CriterionResult | undefined;
  label: string;
  onWatch: (result: CriterionResult) => void;
}): JSX.Element | null {
  if (!result?.attempts.length) return null;
  return (
    <button
      className="text-button"
      aria-label={`Watch recording ${label}`}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        onWatch(result);
      }}
    >
      <Play size={11} aria-hidden="true" /> Watch
    </button>
  );
}

/** Each edge case with its own chip, who Aiden acted as, and its recording. */
function EdgeCases({
  requirement,
  results,
  triage,
  onWatch,
}: {
  requirement: Requirement;
  results: CriterionResult[];
  triage: TriageItem[];
  onWatch: (result: CriterionResult) => void;
}): JSX.Element | null {
  if (!requirement.edgeCases?.length) return null;
  return (
    <div className="req-block">
      <h3>Edge cases</h3>
      <ul className="edge-cases" aria-label={`Edge cases for ${requirement.id}`}>
        {requirement.edgeCases.map((edge) => {
          const result = results.find((r) => r.edgeCaseId === edge.id);
          const plan = triage.find(
            (t) => t.requirementId === requirement.id && t.edgeCaseId === edge.id,
          );
          return (
            <li key={edge.id}>
              <span>
                {edge.text}
                {edge.origin === 'found' && <em className="found-tag"> Found by Aiden</em>}
                {result?.persona &&
                  !edge.text.toLowerCase().includes(result.persona.toLowerCase()) && (
                    <small> As {result.persona}.</small>
                  )}
              </span>
              <span className="row-side">
                <Watch result={result} label={`${requirement.id} ${edge.id}`} onWatch={onWatch} />
                <Chip state={edgeState(result, plan?.method)} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One requirement on the brief: its text, one chip, and how Aiden knows. Opening it shows the edge
 * cases, what the browser check saw, and the code evidence.
 */
export function RequirementRow({
  requirement,
  report,
  state,
  main,
  edges,
  triage,
  onWatch,
  onOpenEvidence,
  children,
  actionCount = 0,
  attention,
}: {
  requirement: Requirement;
  report: Report;
  state: ItemState;
  main: CriterionResult | undefined;
  edges: CriterionResult[];
  triage: TriageItem[];
  onWatch: (result: CriterionResult) => void;
  onOpenEvidence: OpenEvidence;
  children?: ReactNode;
  actionCount?: number;
  attention?: DeliveryAttention | undefined;
}): JSX.Element {
  const assessmentIndex = report.assessments.findIndex((a) => a.requirementId === requirement.id);
  const assessment = report.assessments[assessmentIndex];
  return (
    <details className="req-row" id={`requirement-${requirement.id}`}>
      <summary>
        <span className="row-main">
          <span className="row-title">
            <ChevronRight className="req-chevron" size={13} aria-hidden="true" />
            <code>{requirement.id}</code> {requirement.text}
          </span>
          <span className="row-sub">
            {state.how}
            {actionCount > 0 && ` · ${plural(actionCount, 'action')} remaining`}
          </span>
        </span>
        <span className="row-side">
          <Watch result={main} label={requirement.id} onWatch={onWatch} />
          {attention && <AttentionBadge item={attention} />}
          <Chip state={state} />
        </span>
      </summary>
      <div className="req-detail">
        {children}
        <EdgeCases requirement={requirement} results={edges} triage={triage} onWatch={onWatch} />
        {main && (main.expected || main.observed) && (
          <div className="req-block">
            <h3>In your app</h3>
            <p>{main.explanation}</p>
            {main.expected && <p className="row-sub">Expected: {main.expected}</p>}
            {main.observed && <p className="row-sub">Saw: {main.observed}</p>}
          </div>
        )}
        {assessment && (
          <div className="req-block">
            <h3>In the code</h3>
            <p>{assessment.explanation}</p>
            {assessment.evidence.length > 0 && (
              <div className="evidence-links">
                {assessment.evidence.map((item, evidenceIndex) => (
                  <button
                    key={`${item.repositoryId}:${item.path}:${item.startLine}`}
                    className="text-button"
                    onClick={() => onOpenEvidence(assessmentIndex, evidenceIndex)}
                  >
                    {item.repositoryId} · {item.path}:{item.startLine}
                  </button>
                ))}
              </div>
            )}
            {assessment.remainingWork.length > 0 && (
              <ul className="still-to-do">
                {assessment.remainingWork.map((work, index) => (
                  <li key={index}>{work}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
