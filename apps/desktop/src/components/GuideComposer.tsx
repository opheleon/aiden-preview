import { ArrowUp } from 'lucide-react';
import { type JSX, type RefObject } from 'react';

/** A persistent chat composer that keeps drafts while Aiden replies and supports multiline input. */
export function GuideComposer({
  input,
  draft,
  onChange,
  onSend,
  disabled,
  maxLength = 2000,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onChange: (text: string) => void;
  onSend: (text: string) => void;
  disabled: boolean;
  maxLength?: number;
}): JSX.Element {
  return (
    <form
      className="guide-composer"
      onSubmit={(event) => {
        event.preventDefault();
        const text = draft.trim();
        if (!text || disabled || text.length > maxLength) return;
        onSend(text);
        onChange('');
        input.current?.focus();
      }}
    >
      <textarea
        ref={input}
        aria-label="Message the Guide"
        placeholder="Message Aiden…"
        maxLength={maxLength}
        rows={1}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!disabled) event.currentTarget.form?.requestSubmit();
        }}
      />
      <div className="guide-composer-footer">
        <small>
          {draft.trim().length > maxLength
            ? `Shorten your message by ${draft.trim().length - maxLength} characters to send.`
            : 'Enter to send · Shift + Enter for a new line'}
        </small>
        <button
          className="guide-send"
          aria-label="Send"
          disabled={disabled || !draft.trim() || draft.trim().length > maxLength}
        >
          <ArrowUp size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
