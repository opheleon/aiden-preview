import { type JSX, useRef } from 'react';

/** Project sections keep the overview separate from scope, history, and coding controls. */
export type ProjectTab = 'overview' | 'scope' | 'activity' | 'coding';

/** Accessible project navigation with arrow-key, Home, and End selection. */
export function ProjectTabs({
  selected,
  coding,
  onSelect,
}: {
  selected: ProjectTab;
  coding: boolean;
  onSelect: (tab: ProjectTab) => void;
}): JSX.Element {
  const buttons = useRef<Partial<Record<ProjectTab, HTMLButtonElement | null>>>({});
  const tabs: { id: ProjectTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'scope', label: 'Scope' },
    { id: 'activity', label: 'Activity' },
    ...(coding ? [{ id: 'coding' as const, label: 'Coding' }] : []),
  ];
  return (
    <div className="project-tabs" role="tablist" aria-label="Project sections">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(element) => {
            buttons.current[tab.id] = element;
          }}
          id={`project-tab-${tab.id}`}
          role="tab"
          aria-selected={selected === tab.id}
          aria-controls={`project-panel-${tab.id}`}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            const id = tabs[next]!.id;
            onSelect(id);
            buttons.current[id]?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
