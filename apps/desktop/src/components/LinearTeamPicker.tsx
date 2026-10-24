import { type JSX, useEffect, useId, useRef, useState } from 'react';

import type { LinearTeam } from '../../../../packages/contracts/src/tickets';
import type { Workspace } from '../hooks/useWorkspace';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

/**
 * Choose a Linear team. Teams load only when the picker is first opened, and a response that
 * arrives after the connection changes is ignored. Until teams are listed, the loading, failure
 * (with Retry teams), and no-teams states show under the field; once they load, the list opens.
 */
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
  const listed = !!teams?.length;
  /** Open or close the picker, loading teams the first time; a second press closes the states. */
  const toggle = (next: boolean) => {
    setOpen(next && !(open && !listed));
    if (next && !teams) void load();
  };
  const name = teams?.find((team) => team.id === value)?.name ?? label ?? (value || undefined);
  return (
    <div
      className="linear-team-picker"
      onBlur={(e) => {
        if (!listed && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <span id={`${id}-label`}>Linear team</span>
      <Select
        open={open && listed}
        onOpenChange={toggle}
        value={value}
        onValueChange={onChange}
        disabled={!connectionId || disabled}
      >
        <SelectTrigger
          aria-labelledby={`${id}-label`}
          className="h-auto w-full rounded-[8px] bg-background px-3 py-2.5 text-[13px]"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) setOpen(false);
          }}
        >
          <SelectValue placeholder="Choose a team">{name}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {teams?.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {team.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {open && !listed && (
        <TeamStates loading={loading} error={error} empty={!!teams} onRetry={() => void load()} />
      )}
    </div>
  );
}

/** What the picker shows before any team is listed: loading, a failure with Retry teams, or none. */
function TeamStates({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading: boolean;
  error: string;
  /** Teams loaded, and the list was empty. */
  empty: boolean;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className="linear-team-options">
      {loading && <p role="status">Loading Linear teams…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={onRetry}>
            Retry teams
          </button>
        </>
      )}
      {empty && <p>No teams are available for this connection. Check your Linear access.</p>}
    </div>
  );
}
