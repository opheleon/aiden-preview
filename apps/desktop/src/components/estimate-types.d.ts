import type {
  EstimateOverrides,
  EstimationSnapshot,
  Report,
} from '../../../../packages/contracts/src/index';
/** Accepted assessment and estimate artifacts plus explicit user actions for the estimate workspace. */
export interface RequirementEstimatesProps {
  estimation: EstimationSnapshot;
  report: Report;
  overrides: EstimateOverrides;
  busy: boolean;
  onSave: (next: EstimateOverrides) => Promise<void>;
  onReestimate: () => Promise<void>;
  onConfigureHistory: () => void;
  onOpenExternal: (url: string) => void;
  onOpenEvidence: (assessmentIndex: number, evidenceIndex: number) => void;
}
/** Identifies the requirement and estimate field currently being edited. */
export type EstimateEditing = { id: string; kind: 'size' | 'duration' };
