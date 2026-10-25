import { z } from 'zod/v3';

import type { PlanUsage } from '../../contracts/src/api.js';

export type { PlanUsage } from '../../contracts/src/api.js';
/** One usage window: how much is used, as a fraction, and when it resets. */
export type UsageWindow = { used: number; resetsAt: Date | null };
/** The two windows the allocator compares against the member's cap. */
export type UsageWindows = { fiveHour?: UsageWindow | undefined; weekly?: UsageWindow | undefined };

export const unknownUsage: PlanUsage = { fiveHourUtil: null, weeklyUtil: null, resetsAt: null };

/** A valid date or null; providers send ISO strings or Unix seconds. */
function date(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A window from a percentage, or nothing when the percentage is missing. */
export function usageWindow(
  percent: number | null | undefined,
  resetsAt: string | number | null | undefined,
): UsageWindow | undefined {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined;
  return { used: Math.min(1, Math.max(0, percent / 100)), resetsAt: date(resetsAt) };
}

/** Report both windows; the reset time is the one of the more used window, since that one binds. */
export function planUsage(windows: UsageWindows): PlanUsage {
  const { fiveHour, weekly } = windows;
  const binding = weekly && (!fiveHour || weekly.used > fiveHour.used) ? weekly : fiveHour;
  return {
    fiveHourUtil: fiveHour?.used ?? null,
    weeklyUtil: weekly?.used ?? null,
    resetsAt: binding?.resetsAt?.toISOString() ?? null,
  };
}

const claudeWindow = z
  .object({ utilization: z.number().nullable(), resets_at: z.string().nullable() })
  .nullable()
  .optional();
const claudeSchema = z.object({
  rate_limits: z.object({ five_hour: claudeWindow, seven_day: claudeWindow }).nullable(),
});

/** Claude's experimental usage answer: utilization is a percentage, resets are ISO strings. */
export function claudeWindows(response: unknown): UsageWindows {
  const parsed = claudeSchema.safeParse(response);
  const limits = parsed.success ? parsed.data.rate_limits : null;
  if (!limits) return {};
  return {
    fiveHour: usageWindow(limits.five_hour?.utilization, limits.five_hour?.resets_at),
    weekly: usageWindow(limits.seven_day?.utilization, limits.seven_day?.resets_at),
  };
}

const eventWindow = z.object({ utilization: z.number(), resetsAt: z.number().optional() });
const eventSchema = z.object({
  rateLimitType: z.string().optional(),
  utilization: z.number().optional(),
  resetsAt: z.number().optional(),
  unifiedWindows: z
    .object({ five_hour: eventWindow.optional(), seven_day: eventWindow.optional() })
    .optional(),
});

/**
 * Windows in a run's `rate_limit_event`. Utilization there is a fraction and resets are Unix
 * seconds; current Claude Code sends both windows under `unifiedWindows`, older ones only one.
 */
export function claudeEventWindows(info: unknown): UsageWindows {
  const parsed = eventSchema.safeParse(info);
  if (!parsed.success) return {};
  const { rateLimitType, utilization, resetsAt, unifiedWindows } = parsed.data;
  const single = utilization === undefined ? undefined : { utilization, resetsAt };
  const five = unifiedWindows?.five_hour ?? (rateLimitType === 'five_hour' ? single : undefined);
  const week = unifiedWindows?.seven_day ?? (rateLimitType === 'seven_day' ? single : undefined);
  const windows: UsageWindows = {};
  if (five) windows.fiveHour = usageWindow(five.utilization * 100, five.resetsAt);
  if (week) windows.weekly = usageWindow(week.utilization * 100, week.resetsAt);
  return windows;
}

const codexWindow = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().nullable().optional(),
    resetsAt: z.number().nullable().optional(),
  })
  .nullable()
  .optional();
const codexSchema = z.object({
  rateLimits: z.object({ primary: codexWindow, secondary: codexWindow }),
});

/** Codex `account/rateLimits/read`: windows are matched by length, resets are Unix seconds. */
export function codexPlanUsage(response: unknown): PlanUsage {
  const parsed = codexSchema.safeParse(response);
  if (!parsed.success) return unknownUsage;
  const windows: UsageWindows = {};
  for (const limit of [parsed.data.rateLimits.primary, parsed.data.rateLimits.secondary]) {
    if (!limit) continue;
    const window = usageWindow(limit.usedPercent, limit.resetsAt);
    if (limit.windowDurationMins === 300) windows.fiveHour = window;
    if (limit.windowDurationMins === 10080) windows.weekly = window;
  }
  return planUsage(windows);
}
