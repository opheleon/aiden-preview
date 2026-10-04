import { type JSX, useEffect, useRef, useState } from 'react';

import dailyWorkflow from '../../../../docs/daily-workflow.md?raw';
import gettingStarted from '../../../../docs/getting-started.md?raw';
import troubleshooting from '../../../../docs/troubleshooting.md?raw';

const topics = [
  { title: 'Getting started', source: gettingStarted },
  { title: 'Daily workflow', source: dailyWorkflow },
  { title: 'Troubleshooting', source: troubleshooting },
];

/** Render bundled, plain-prose docs without HTML execution, network access, or external navigation. */
export function GuideDocumentation(): JSX.Element {
  const [topic, setTopic] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [topic]);
  const content = topics[topic]!;
  return (
    <div className="guide-content guide-docs">
      <h1 id="guide-title" ref={heading} tabIndex={-1}>
        Documentation
      </h1>
      <p id="guide-summary" className="guide-summary">
        Available offline, whenever you need it.
      </p>
      <nav aria-label="Documentation topics" className="guide-doc-topics">
        {topics.map((item, index) => (
          <button
            key={item.title}
            className="secondary"
            aria-pressed={topic === index}
            onClick={() => setTopic(index)}
          >
            {item.title}
          </button>
        ))}
      </nav>
      <article aria-label={content.title}>
        {content.source
          .trim()
          .split(/\n\s*\n/)
          .map((block) => {
            if (block.startsWith('# ')) return <h2 key={block}>{block.slice(2)}</h2>;
            if (block.startsWith('## ')) return <h3 key={block}>{block.slice(3)}</h3>;
            return <p key={block}>{block.replace(/\n/g, ' ')}</p>;
          })}
      </article>
    </div>
  );
}
