import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DeliveryAttention } from '../../apps/desktop/src/components/DeliveryAttention';
import { deliveryAttention } from '../../apps/desktop/src/renderer/delivery-attention';
import type { Check, ItemState } from '../../apps/desktop/src/renderer/requirement-status';
import type { Product, RunManifest } from '../../packages/contracts/src/index';
import type { TicketState } from '../../packages/contracts/src/tickets';
import { appFixture } from './app-fixture';
import { report } from './fixtures';

const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
const changed = '2026-01-01T10:00:00.000Z';
const after = '2026-01-01T10:01:00.000Z';
const product: Product = {
  ...report.baseline,
  deliveryPlan: [
    {
      id: 'F-1',
      title: 'Read books',
      outcome: 'Find a book.',
      rationale: 'First value.',
      kind: 'feature',
      requirementIds: ['REQ-1'],
      dependsOn: [],
    },
    {
      id: 'F-2',
      title: 'Create books',
      outcome: 'Add a book.',
      rationale: 'Next value.',
      kind: 'feature',
      requirementIds: ['REQ-2'],
      dependsOn: ['F-1'],
    },
  ],
};
const current = {
  ...report,
  baseline: product,
  generatedAt: after,
  assessments: report.assessments.map((a) => ({
    ...a,
    status: 'missing' as const,
    deviation: false,
    explanation: 'The implementation is absent.',
  })),
};
const tracker: TicketState = {
  settings: null,
  externalChangeAt: changed,
  records: [
    {
      featureId: 'F-1',
      title: 'Read books',
      marker: 'test',
      state: 'synced',
      issueId: 'TES-13',
      remoteStatus: 'Done',
      remoteStatusType: 'completed',
      url: 'https://linear.app/test/issue/TES-13',
    },
  ],
};
const states = new Map<string, ItemState>(
  product.requirements.map((r) => [
    r.id,
    { label: 'Not started', tone: 'incomplete', how: 'No code yet.' },
  ]),
);
const run = {
  id: current.id,
  kind: 'report',
  status: 'completed',
  createdAt: after,
} as RunManifest;
function input() {
  return { product, report: current, states, tracker: structuredClone(tracker), runs: [run] };
}

test('closed incomplete work is a delivery deviation even when ticket synchronization succeeded', () => {
  const found = deliveryAttention(input());
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({
    kind: 'deviation',
    requirementIds: ['REQ-1'],
    summary: 'TES-13 is marked Done, but its requirements are incomplete.',
    impact: 'Delivery of Create books depends on this step.',
  });
  expect(found[0]?.evidence.join(' ')).toContain('implementation is absent');
});

test('closure waits for a fresh report and failed or missing assessments remain unverified', () => {
  const value = input();
  value.tracker.needsAssessment = true;
  value.runs = [{ ...run, createdAt: '2025-01-01T00:00:00.000Z' }];
  expect(deliveryAttention(value)[0]?.kind).toBe('checking');
  value.runs.unshift({ ...run, id: 'failed', status: 'failed' });
  expect(deliveryAttention(value)[0]?.kind).toBe('unverified');
  value.runs[0]!.status = 'cancelled';
  expect(deliveryAttention(value)[0]?.kind).toBe('unverified');
  value.tracker.needsAssessment = false;
  value.runs = [];
  expect(deliveryAttention({ ...value, report: undefined })[0]?.kind).toBe('unverified');
  expect(
    deliveryAttention({
      ...value,
      runs: [{ ...run, id: 'active', status: 'running' }],
      report: undefined,
    })[0]?.kind,
  ).toBe('checking');
});

test('unknown evidence and outstanding acceptance checks never become missing-code claims', () => {
  for (const status of ['unknown', 'implemented'] as const) {
    const value = input();
    expect(
      deliveryAttention({
        ...value,
        report: { ...current, assessments: current.assessments.map((a) => ({ ...a, status })) },
      })[0]?.kind,
    ).toBe('unverified');
  }
});

test('fresh completion clears the warning; reopening and cancellation do not claim delivery', () => {
  const value = input();
  const done = new Map([...states].map(([id, state]) => [id, { ...state, label: 'Done' }]));
  expect(deliveryAttention({ ...value, states: done })).toEqual([]);
  for (const status of ['started', 'canceled', undefined]) {
    value.tracker.records[0]!.remoteStatusType = status;
    expect(deliveryAttention(value)).toEqual([]);
  }
  value.tracker.records[0]!.state = 'retired';
  expect(deliveryAttention(value)).toEqual([]);
  expect(deliveryAttention({ ...value, product: undefined })).toEqual([]);
});

test('contradictory behavior is visible without a tracker and legacy requirement plans still work', () => {
  const value = {
    ...input(),
    tracker: null,
    report: {
      ...current,
      assessments: [{ ...current.assessments[0]!, deviation: true }, current.assessments[1]!],
    },
  };
  expect(deliveryAttention(value)[0]?.summary).toContain('contradicts');
  expect(deliveryAttention({ ...value, product: report.baseline })[0]?.featureId).toBe('F-1');
  expect(deliveryAttention({ ...input(), tracker: null })).toEqual([]);
  const failing = new Map(states);
  failing.set('REQ-1', { label: 'Failing', tone: 'incomplete', how: 'Fails in the app.' });
  expect(deliveryAttention({ ...input(), tracker: null, states: failing })[0]?.kind).toBe(
    'deviation',
  );
});

test('per-ticket timestamps avoid making unrelated closures look stale', () => {
  const value = input();
  value.tracker.externalChangeAt = '2026-02-01T00:00:00.000Z';
  value.tracker.records[0]!.remoteStatusChangedAt = changed;
  expect(deliveryAttention(value)[0]?.kind).toBe('deviation');
});

test('overview prioritizes the disconnect as one line per finding, with the full story in the requirement pop-up', async () => {
  f.reset();
  f.setReport(current);
  f.setTickets(tracker);
  f.addRun(run);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  const attention = await screen.findByRole('region', { name: 'Delivery attention' });
  expect(
    within(attention).getByRole('heading', { name: 'Delivery at risk · 1 deviation' }),
  ).toBeVisible();
  expect(
    attention.compareDocumentPosition(screen.getByRole('region', { name: 'Status' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The finding is one line: the feature and its label, which explains itself on hover.
  expect(within(attention).getByText('Delivery deviation')).toHaveAttribute(
    'title',
    'TES-13 is marked Done, but its requirements are incomplete.',
  );
  expect(within(attention).queryByText(/The implementation is absent/)).toBeNull();
  const feature = screen.getByRole('region', { name: 'Read books' });
  expect(within(feature).getAllByText('Delivery deviation')).toHaveLength(2);
  await userEvent.click(within(attention).getByRole('button', { name: 'Read books' }));
  const sheet = screen.getByRole('dialog', { name: 'Requirement REQ-1' });
  const finding = within(sheet).getByRole('region', { name: 'Delivery attention' });
  expect(finding).toHaveTextContent('TES-13 is marked Done, but its requirements are incomplete.');
  expect(finding).toHaveTextContent('Delivery of Create books depends on this step.');
  expect(within(finding).getByText(/The implementation is absent/)).toBeVisible();
  expect(within(finding).getByRole('link', { name: 'Open TES-13' })).toHaveAttribute(
    'href',
    tracker.records[0]!.url,
  );
  await userEvent.click(within(sheet).getByRole('button', { name: 'Close requirement REQ-1' }));
  expect(document.activeElement).toBe(
    within(attention).getByRole('button', { name: 'Read books' }),
  );
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
});

test('unverified completion offers an explicit retry; resolved findings remove the card', async () => {
  const onCheck = vi.fn();
  const onOpen = vi.fn();
  const items = deliveryAttention({ ...input(), report: undefined, runs: [] });
  const { rerender } = render(
    <DeliveryAttention items={items} busy={false} onCheck={onCheck} onOpen={onOpen} />,
  );
  expect(screen.getByText('Completion unverified')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Run check again' }));
  expect(onCheck).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Read books' }));
  expect(onOpen).toHaveBeenCalledWith('REQ-1');
  rerender(<DeliveryAttention items={items} busy onCheck={onCheck} onOpen={onOpen} />);
  expect(screen.getByRole('button', { name: 'Run check again' })).toBeDisabled();
  rerender(<DeliveryAttention items={[]} busy={false} onCheck={onCheck} onOpen={onOpen} />);
  expect(screen.queryByRole('region', { name: 'Delivery attention' })).toBeNull();
});

test('a failed acceptance edge case is a deviation even when the main path and code pass', () => {
  const value = input();
  const result = deliveryAttention({
    ...value,
    report: {
      ...current,
      assessments: current.assessments.map((a) => ({ ...a, status: 'implemented' })),
    },
    check: {
      result: {
        criteria: [
          {
            requirementId: 'REQ-1',
            edgeCaseId: 'E1',
            verdict: 'fail',
            explanation: 'The banner overlaps controls.',
          },
        ],
      },
    } as Check,
  });
  expect(result[0]?.kind).toBe('deviation');
  expect(result[0]?.evidence.join(' ')).toContain('overlaps controls');
});

test('closed tickets with only local or legacy code are completion-unverified, not remote deviations', () => {
  const value = input();
  const local = {
    ...current,
    snapshots: current.snapshots.map((s) => ({ ...s, source: 'local' as const })),
  };
  expect(deliveryAttention({ ...value, report: local })[0]?.kind).toBe('unverified');
  expect(
    deliveryAttention({
      ...value,
      tracker: null,
      report: { ...local, assessments: local.assessments.map((a) => ({ ...a, deviation: true })) },
    }),
  ).toEqual([]);
});
