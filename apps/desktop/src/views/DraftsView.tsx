import { ArrowRight, ChevronRight, FileText } from 'lucide-react';

interface DraftsViewProps {
  reviewRun: string;
  setArea: React.Dispatch<React.SetStateAction<'projects' | 'drafts' | 'settings'>>;
  setStep: React.Dispatch<React.SetStateAction<number>>;
}

/** Explain pending requirement reviews and return to the active draft. */
export function DraftsView(props: DraftsViewProps): React.JSX.Element {
  const { reviewRun, setArea, setStep } = props;
  return (
    <div className="content drafts-view">
      <div className="breadcrumb">
        Aiden <ChevronRight size={13} />
        <strong>Drafts</strong>
      </div>
      <div className="title-row">
        <div>
          <h1>
            Project <span className="serif">drafts.</span>
          </h1>
          <p className="subtitle">New-project work stays here until requirements are reviewed.</p>
        </div>
      </div>
      <section className="card empty">
        <FileText size={30} />
        <h2>{reviewRun ? 'One review is ready.' : 'No pending drafts.'}</h2>
        <p>
          {reviewRun
            ? 'Return to the current project to review and approve its extracted requirements.'
            : 'Start a project to add repositories and project context.'}
        </p>
        {reviewRun && (
          <button
            className="primary"
            onClick={() => {
              setArea('projects');
              setStep(2);
            }}
          >
            Review requirements <ArrowRight size={15} />
          </button>
        )}
      </section>
    </div>
  );
}
