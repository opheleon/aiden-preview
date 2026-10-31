import type { JSX } from 'react';

import {
  type TaskStatus,
  taskStatusLabels,
  type TaskWho,
} from '../../../../packages/contracts/src/task-model';

/** Who does a task: Aiden, PM, or Dev, styled the same in the project view and Work. */
export function TaskChip({ who }: { who: TaskWho }): JSX.Element {
  return <span className={`chip chip--${who.toLowerCase()}`}>{who}</span>;
}

/** Where a task stands, in the shared status words. */
export function TaskStatusTag({ status }: { status: TaskStatus }): JSX.Element {
  return <span className={`task-status task-status--${status}`}>{taskStatusLabels[status]}</span>;
}
