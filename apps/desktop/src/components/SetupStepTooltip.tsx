import { Info } from 'lucide-react';
import { type JSX, useEffect, useId, useRef, useState } from 'react';

/** Explain a setup step on hover or focus without moving the chat or taking focus. */
export function SetupStepTooltip({ label, text }: { label: string; text: string }): JSX.Element {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const visible = (hovered || focused) && !dismissed;

  /** Keep the tooltip inside the viewport, including when the chat is resized. */
  function positionTooltip(): void {
    const bounds = button.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(288, window.innerWidth - 32);
    setPosition({
      left: Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16)),
      top: bounds.bottom - 1,
    });
  }

  useEffect(() => {
    if (!visible) return;
    /** Escape dismisses this explanation before the surrounding chat. */
    function dismiss(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('resize', positionTooltip);
    return () => {
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('resize', positionTooltip);
    };
  }, [visible]);

  return (
    <span
      className="setup-info-anchor"
      onMouseEnter={() => {
        positionTooltip();
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={button}
        className="setup-info"
        aria-label={`About ${label}`}
        aria-describedby={visible ? id : undefined}
        onFocus={() => {
          positionTooltip();
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
      >
        <Info size={15} aria-hidden="true" />
      </button>
      {visible && (
        <span
          id={id}
          role="tooltip"
          aria-label={`About ${label}`}
          className="setup-tooltip"
          style={position}
        >
          <span className="setup-tooltip-content">{text}</span>
        </span>
      )}
    </span>
  );
}
