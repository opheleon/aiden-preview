import { Clock } from 'lucide-react';
import { type JSX, useEffect, useState } from 'react';

import type { Baseline, Project } from '../../../../packages/contracts/src/index';
import type { DesktopBridge } from '../bridge';
import type { ProjectSchedule, ScheduleConfig } from '../scheduler';

const defaults: ScheduleConfig = {
  enabled: false,
  frequency: 'daily',
  time: '09:00',
  weekday: 1,
  includeEstimates: true,
};
/** Load and edit the selected project’s opt-in local schedule, preserving unsaved edits during polling. */
export default function ScheduleSettings({
  project,
  baseline,
  api,
}: {
  project: Project;
  baseline?: Baseline | undefined;
  api?: DesktopBridge | undefined;
}): JSX.Element {
  const [config, setConfig] = useState<ScheduleConfig>(defaults);
  const [saved, setSaved] = useState<ProjectSchedule>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let initial = true;
    /** Poll persisted run status, initializing editable configuration only once per project. */
    async function refresh() {
      try {
        const schedule = (await api?.getSchedules())?.find((s) => s.projectId === project.id);
        if (cancelled) return;
        setSaved(schedule);
        if (initial) {
          setConfig(schedule ?? defaults);
          initial = false;
        }
        setLoaded(true);
      } catch {
        if (!cancelled) setError('Could not load local schedules.');
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [project.id, api]);
  /** Persist only editable configuration and surface failures without discarding the user’s inputs. */
  async function save() {
    if (!api) return;
    setSaving(true);
    setError('');
    try {
      // Send configuration only, never scheduler-owned run metadata.
      const next = await api.setSchedule(project.id, {
        enabled: config.enabled,
        frequency: config.frequency,
        time: config.time,
        weekday: config.weekday,
        includeEstimates: config.includeEstimates,
      });
      setSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the schedule.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card settings-panel">
      <div className="card-heading">
        <div className="section-icon">
          <Clock size={19} />
        </div>
        <div>
          <h2>Local schedule</h2>
          <p>Refresh {project.name || 'this project'} while Aiden is open.</p>
        </div>
      </div>
      {!baseline && <p>Approve this project’s requirements to enable scheduled assessments.</p>}
      <label className="settings-toggle">
        <input
          type="checkbox"
          aria-label="Enable local schedule"
          disabled={!baseline || !loaded}
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
        />
        Run on a schedule
      </label>
      <ScheduleFields config={config} setConfig={setConfig} />
      <p className="fine-print">
        Uses the saved project’s provider, authentication, model, and reviewed requirements. Save
        model changes separately. Times follow this computer’s time zone. Closing Aiden pauses
        scheduling; missed times after sleep or closing are skipped. Active work is never
        interrupted. Runs needing clarification stop for manual review. Disabling a schedule stops
        future runs; cancel current work from the project.
      </p>
      <button
        className="primary"
        disabled={!loaded || saving || !config.time || (config.enabled && !baseline)}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : 'Save schedule'}
      </button>
      {saved && (
        <p role="status">
          {saved.enabled && saved.nextRunAt
            ? `Next run: ${new Date(saved.nextRunAt).toLocaleString()}`
            : 'Schedule off.'}
        </p>
      )}
      {saved?.lastRunAt && (
        <p>
          Last scheduled attempt: {new Date(saved.lastRunAt).toLocaleString()} · {saved.lastStatus}.{' '}
          {saved.message}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-save-error">
          {error}
        </p>
      )}
    </section>
  );
}

/** Edit frequency, local calendar time, and whether accepted assessments should refresh estimates. */
function ScheduleFields({
  config,
  setConfig,
}: {
  config: ScheduleConfig;
  setConfig: (config: ScheduleConfig) => void;
}): JSX.Element {
  return (
    <>
      <div className="schedule-fields">
        <label>
          Frequency
          <select
            aria-label="Schedule frequency"
            value={config.frequency}
            onChange={(e) =>
              setConfig({ ...config, frequency: e.target.value as 'daily' | 'weekly' })
            }
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        {config.frequency === 'weekly' && (
          <label>
            Day
            <select
              aria-label="Schedule weekday"
              value={config.weekday}
              onChange={(e) => setConfig({ ...config, weekday: Number(e.target.value) })}
            >
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                (day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        <label>
          Local time
          <input
            type="time"
            aria-label="Schedule time"
            value={config.time}
            onChange={(e) => setConfig({ ...config, time: e.target.value })}
          />
        </label>
      </div>
      <label className="settings-toggle">
        <input
          type="checkbox"
          aria-label="Include scheduled estimates"
          checked={config.includeEstimates}
          onChange={(e) => setConfig({ ...config, includeEstimates: e.target.checked })}
        />
        Refresh estimates after a successful assessment
      </label>
    </>
  );
}
