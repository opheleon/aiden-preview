import { type JSX, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import type { LinearTeam } from '../../../../packages/contracts/src/tickets';
import type { Workspace } from '../hooks/useWorkspace';

/** Load actual Linear teams only when the picker is opened; ignore responses after connection changes. */
export function LinearTeamPicker({
  workspace,
  connectionId,
  value,
  onChange,
  disabled = false,
  label,
}: {
  workspace: Workspace;
  connectionId: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string | undefined;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<LinearTeam[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const id = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** Keep lazy reads bounded to one request, with an explicit retry after connection failure. */
  const load = async () => {
    if (pending.current || !connectionId) return;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      const rows = await workspace.call('linearTeams', { connectionId });
      if (alive.current) setTeams(rows);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not load Linear teams.');
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  };
  /** Move among loaded options with standard listbox keys and return focus when dismissed. */
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    const index = options.findIndex((option) => option === document.activeElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  };
  return (
    <div
      className="linear-team-picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <span id={`${id}-label`}>Linear team</span>
      <button
        ref={trigger}
        type="button"
        className="secondary"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-controls={id}
        aria-expanded={open}
        disabled={!connectionId || disabled}
        onClick={() => {
          setOpen(!open);
          if (!teams && !open) void load();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            if (!teams) void load();
            if (open)
              document
                .getElementById(id)
                ?.querySelector<HTMLButtonElement>('[role="option"]')
                ?.focus();
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        {teams?.find((team) => team.id === value)?.name ?? label ?? (value || 'Choose a team')} ▾
      </button>
      {open && (
        <div className="linear-team-options">
          {loading && <p role="status">Loading Linear teams…</p>}
          {error && (
            <>
              <p role="alert">{error}</p>
              <button type="button" onClick={() => void load()}>
                Retry teams
              </button>
            </>
          )}
          {teams?.length === 0 && (
            <p>No teams are available for this connection. Check your Linear access.</p>
          )}
          <div
            tabIndex={-1}
            role="listbox"
            aria-labelledby={`${id}-label`}
            id={id}
            onKeyDown={navigate}
          >
            {teams?.map((team) => (
              <button
                type="button"
                role="option"
                aria-selected={team.id === value}
                key={team.id}
                onClick={() => {
                  onChange(team.id);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                {team.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
