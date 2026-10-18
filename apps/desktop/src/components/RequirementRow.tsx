import { Play } from 'lucide-react';
import type { JSX, MouseEvent } from 'react';

import type { CriterionResult, Report, TriageItem } from '../../../../packages/contracts/src/index';
import type { DeliveryAttention } from '../renderer/delivery-attention';
import { edgeState, type ItemState, plural } from '../renderer/requirement-status';
import { AttentionBadge } from './DeliveryAttention';

type Requirement = Report['baseline']['requirements'][number];
/** Open one cited code excerpt from the accepted report. */
export type OpenEvidence = (assessmentIndex: number, evidenceIndex: number) => void;

/** A status chip in the shared badge style; the tooltip says how Aiden knows. */
export function Chip({ state, title }: { state: ItemState; title?: string }): JSX.Element {
  return (
    <span className={`chip chip--${state.tone}`} title={title}>
      {state.label}
    </span>
  );
}

/** Play button for a browser check that has a recording; it never opens the row. */
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
        event.stopPropagation();
        onWatch(result);
      }}
    >
      <Play size={11} aria-hidden="true" /> Watch
    </button>
  );
}

/**
 * One requirement on the brief: its text and one chip. The chip's tooltip says how Aiden knows,
 * and the row opens the requirement's full story in a pop-up.
 */
export function RequirementRow({
  id,
  text,
  state,
  main,
  onWatch,
  onOpen,
  actionCount = 0,
  attention,
}: {
  id: string;
  text: string;
  state: ItemState;
  main?: CriterionResult | undefined;
  onWatch: (result: CriterionResult) => void;
  onOpen: (id: string) => void;
  actionCount?: number;
  attention?: DeliveryAttention | undefined;
}): JSX.Element {
  const how = `${state.how}${actionCount > 0 ? ` · ${plural(actionCount, 'action')} remaining` : ''}`;
  return (
    <li className="req-row" id={`requirement-${id}`}>
      <button type="button" className="req-open" aria-haspopup="dialog" onClick={() => onOpen(id)}>
        <span className="row-title">
          <code>{id}</code> {text}
        </span>
      </button>
      <span className="row-side">
        <Watch result={main} label={id} onWatch={onWatch} />
        {attention && <AttentionBadge item={attention} />}
        <Chip state={state} title={how} />
      </span>
    </li>
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

/** The evidence behind a requirement: edge cases, what the browser check saw, and the code. */
export function RequirementDetail({
  requirement,
  report,
  main,
  edges,
  triage,
  onWatch,
  onOpenEvidence,
}: {
  requirement: Requirement;
  report: Report;
  main: CriterionResult | undefined;
  edges: CriterionResult[];
  triage: TriageItem[];
  onWatch: (result: CriterionResult) => void;
  onOpenEvidence: OpenEvidence;
}): JSX.Element {
  const assessmentIndex = report.assessments.findIndex((a) => a.requirementId === requirement.id);
  const assessment = report.assessments[assessmentIndex];
  return (
    <>
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
    </>
  );
}
