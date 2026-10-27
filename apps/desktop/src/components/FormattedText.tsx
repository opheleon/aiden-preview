import type { JSX } from 'react';

/** A list marker ("- ", "* ", or "1. ") at the start of a line. */
const bullet = /^\s*(?:[-*]|\d+[.)])\s+/;
/** Inline code or an https address, the only inline marks rendered. */
const marks = /(`[^`]+`|https:\/\/[^\s]+[^\s.,;:!?)'"])/;

/** A paragraph of lines, or a list of items. */
interface Block {
  list: boolean;
  lines: string[];
}

/**
 * Split markdown-light text into paragraphs and lists: blank lines end a block, and list lines
 * group into one list. Example: "Pick one:\n- Stripe\n- Paddle" is a paragraph and a list.
 */
export function textBlocks(text: string): Block[] {
  const result: Block[] = [];
  for (const raw of text.trim().split('\n')) {
    const line = raw.replace(/^#+\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1');
    const list = bullet.test(line);
    const last = result.at(-1);
    if (!line.trim()) {
      if (last?.lines.length) result.push({ list: false, lines: [] });
    } else if (last && (last.list === list || !last.lines.length)) {
      last.list = list;
      last.lines.push(list ? line.replace(bullet, '') : line);
    } else result.push({ list, lines: [list ? line.replace(bullet, '') : line] });
  }
  return result.filter((block) => block.lines.length);
}

/** One line with code spans and links that open in the browser; the rest stays plain text. */
function Inline({ text }: { text: string }): JSX.Element {
  return (
    <>
      {text.split(marks).map((part, index) => {
        if (index % 2 === 0) return part;
        if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
        return (
          <a
            key={index}
            href={part}
            onClick={(event) => {
              event.preventDefault();
              void window.aiden?.openExternal(part);
            }}
          >
            {part}
          </a>
        );
      })}
    </>
  );
}

/** Text Aiden or a teammate wrote, shown with its paragraphs, line breaks, and lists. */
export function FormattedText({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}): JSX.Element | null {
  const blocks = textBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className={`formatted-text ${className}`.trim()}>
      {blocks.map((block, index) =>
        block.list ? (
          <ul key={index}>
            {block.lines.map((line, item) => (
              <li key={item}>
                <Inline text={line} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((line, item) => (
              <span key={item}>
                {item > 0 && <br />}
                <Inline text={line} />
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
