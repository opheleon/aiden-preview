import { type JSX, type ReactNode, useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

/**
 * A pop-up over the brief for anything that is not needed on every visit: a requirement's full
 * story, the plan editor, ticket publishing, or check evidence. Escape and the Close button dismiss
 * it, and focus returns to the control that opened it. Stacked pop-ups close one at a time, topmost
 * first. A click on the backdrop does nothing, so a stray click never discards an unsaved edit.
 */
export function Modal({
  label,
  closeLabel,
  eyebrow,
  title,
  description,
  onClose,
  children,
  className = '',
}: {
  /** Accessible name of the dialog, also the basis of the Close button's label. */
  label: string;
  /** Close button label when the one derived from `label` reads wrong. */
  closeLabel?: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** A short line under the title, such as where the content came from. */
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Extra classes; pass a Tailwind width such as `w-[720px]` to change the default 560px. */
  className?: string;
}): JSX.Element {
  // Radix returns focus only to a Dialog.Trigger, and these pop-ups open from ordinary buttons.
  // The opener is read during the first render, before Radix moves focus into the dialog.
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`modal ${className}`.trim()}
        closeLabel={closeLabel ?? `Close ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        // The label names the dialog even when a longer title is shown.
        aria-label={label}
        aria-labelledby={undefined}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          // Focus the dialog itself rather than its first control, so Enter cannot fire an action.
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
      >
        <div className="card-heading pr-8">
          <div className="modal-heading">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <DialogTitle className={title ? undefined : 'sr-only'}>{title ?? label}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
