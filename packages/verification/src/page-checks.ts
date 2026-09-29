import type { Locator } from 'playwright';

import type { CheckState } from '../../contracts/src/index.js';

/** Deterministic result of one structural check, phrased for a non-technical reader. */
export interface CheckOutcome {
  passed: boolean;
  actual: string;
}

type Checker = (target: Locator, label: string, text: string | null) => Promise<CheckOutcome>;

const quick = { timeout: 2000 };

/** Collapse whitespace and cap length so page text stays readable in the report. */
function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

/** Compare case-insensitively; an omitted expectation only requires some content. */
function matches(actual: string, expected: string | null): boolean {
  return expected === null || actual.toLowerCase().includes(expected.trim().toLowerCase());
}

/** Evaluate a boolean element state and describe what Aiden saw either way. */
function flag(
  read: (target: Locator) => Promise<boolean>,
  want: boolean,
  yes: string,
  no: string,
): Checker {
  return async (target, label) => {
    const value = await read(target);
    return { passed: value === want, actual: `${label} is ${value ? yes : no}.` };
  };
}

/** Each check state maps to one Playwright read; Aiden, not the model, decides whether it passed. */
export const checkers: Record<CheckState, Checker> = {
  visible: flag((t) => t.isVisible(), true, 'visible', 'on the page but not visible'),
  hidden: flag((t) => t.isVisible(), false, 'visible', 'not visible'),
  enabled: flag((t) => t.isEnabled(quick), true, 'enabled', 'disabled'),
  disabled: flag((t) => t.isEnabled(quick), false, 'enabled', 'disabled'),
  checked: flag((t) => t.isChecked(quick), true, 'checked', 'not checked'),
  unchecked: flag((t) => t.isChecked(quick), false, 'checked', 'not checked'),
  has_text: async (target, label, text) => {
    const actual = clip(await target.innerText(quick));
    return {
      passed: actual.length > 0 && matches(actual, text),
      actual: actual ? `${label} reads "${actual}".` : `${label} has no text.`,
    };
  },
  has_value: async (target, label, text) => {
    const actual = clip(await target.inputValue(quick));
    return {
      passed: actual.length > 0 && matches(actual, text),
      actual: actual ? `${label} contains "${actual}".` : `${label} is empty.`,
    };
  },
};

/** Describe a page check in plain words for the step log and progress messages. */
export function checkLabel(role: string, name: string, state: CheckState, text?: string): string {
  const target = `${role} "${name}"`;
  if (state === 'has_text')
    return text ? `Checked that ${target} shows "${text}"` : `Checked that ${target} has text`;
  if (state === 'has_value')
    return text
      ? `Checked that ${target} has the value "${text}"`
      : `Checked that ${target} has a value`;
  return `Checked that ${target} is ${state === 'unchecked' ? 'not checked' : state}`;
}
