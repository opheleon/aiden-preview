import { X } from 'lucide-react';
import { type JSX, type ReactNode, useEffect, useRef } from 'react';

/**
 * A pop-up over the brief for anything that is not needed on every visit: a requirement's full
 * story, the plan editor, or ticket publishing. Escape and the Close button dismiss it, and focus
 * returns to the control that opened it. Stacked pop-ups close one at a time, topmost first.
 */
export function Modal({
  label,
  eyebrow,
  title,
  onClose,
  children,
  className = '',
}: {
  /** Accessible name of the dialog, also the basis of the Close button's label. */
  label: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    /** Only the topmost pop-up answers Escape, so a stacked evidence viewer closes first. */
    const onKey = (event: KeyboardEvent) => {
      const overlays = document.querySelectorAll('.modal-overlay');
      if (event.key === 'Escape' && overlays[overlays.length - 1] === overlay.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-overlay" ref={overlay}>
      <section
        className={`modal card ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className="card-heading">
          <div className="modal-heading">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
          </div>
          <button
            className="icon-button"
            aria-label={`Close ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
