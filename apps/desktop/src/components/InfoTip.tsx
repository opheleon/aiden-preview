import { Info } from 'lucide-react';
import { type JSX, type ReactNode, useState } from 'react';

/**
 * Explanatory text behind a small (i) button instead of a permanent paragraph. It opens on click
 * and closes on a second click or Escape. A collapsible row that contains it ignores the click,
 * so reading the note never toggles the row.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open && (
        <span className="info-tip-panel" role="note">
          {children}
        </span>
      )}
    </span>
  );
}

/** Whether a click inside a collapsible row landed on an info note, which must not toggle the row. */
export function insideInfoTip(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('.info-tip');
}
