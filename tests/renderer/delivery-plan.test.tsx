import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { DeliveryPlanEditor } from '../../apps/desktop/src/components/DeliveryPlanEditor';
import {
  featureProgress,
  orderedPlan,
  progressChange,
  reconcilePlan,
} from '../../apps/desktop/src/renderer/delivery-progress';
import {
  requirementFacts,
  requirementState,
} from '../../apps/desktop/src/renderer/requirement-status';
import type { DeliveryFeature, Product } from '../../packages/contracts/src/index';
import { appFixture } from './app-fixture';
import { report } from './fixtures';

const f = appFixture();
const { default: App } = await import('../../apps/desktop/src/App');
const first: DeliveryFeature = {
  id: 'F-1',
  title: 'Browse books',
  outcome: 'Find a book in the library.',
  rationale: 'Deliver reading before editing.',
  kind: 'feature',
  requirementIds: ['REQ-1'],
  dependsOn: [],
};
const second: DeliveryFeature = {
  id: 'F-2',
  title: 'Create books',
  outcome: 'Add a book and see it in the library.',
  rationale: 'Reuse the library.',
  kind: 'feature',
  requirementIds: ['REQ-2'],
  dependsOn: ['F-1'],
};
const product: Product = { ...report.baseline, deliveryPlan: [first, second] };
const done = { label: 'Done', tone: 'verified' as const, how: 'Checked in the app.' };

test('planned projects show one ordered work hierarchy and actions remain inside requirements', async () => {
  f.reset();
  f.setReport({ ...report, baseline: product });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  const browse = await screen.findByRole('region', { name: 'Browse books' });
  expect(browse).toHaveTextContent('Delivery deviation');
  const create = screen.getByRole('region', { name: 'Create books' });
  expect(create).toHaveTextContent('Waiting on prerequisites');
  expect(within(browse).getByText('Find a book in the library.')).not.toBeVisible();
  await userEvent.click(within(browse).getByRole('heading', { name: 'F-1 Browse books' }));
  await userEvent.click(within(create).getByRole('heading', { name: 'F-2 Create books' }));
  expect(within(create).getByRole('link', { name: 'Browse books' })).toHaveAttribute(
    'href',
    '#feature-F-1',
  );
  expect(screen.getByRole('progressbar')).toHaveAttribute('max', '2');
  expect(screen.getByText(/No target agreed yet/)).not.toBeVisible();
  await userEvent.click(screen.getByText('Progress details and estimates'));
  expect(screen.getByText(/No target agreed yet/)).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull();
  expect(
    within(browse).getByRole('button', { name: 'Copy work item' }).closest('details'),
  ).not.toHaveAttribute('open');
  await userEvent.click(
    within(browse).getByText('Users can list books.', { selector: '.row-title' }),
  );
  expect(within(browse).getByRole('button', { name: 'Copy work item' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Adjust plan' }));
  expect(screen.getByRole('button', { name: 'Move Create books earlier' })).toBeDisabled();
});

test('plan edits respect prerequisites and save the full plan without a mandatory approval flow', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(<DeliveryPlanEditor product={product} busy={false} onSave={save} onClose={close} />);
  expect(screen.getByRole('button', { name: 'Move Browse books later' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Browse books' }));
  await userEvent.click(screen.getByRole('button', { name: 'Move Create books earlier' }));
  await userEvent.clear(screen.getByLabelText('Name F-2'));
  await userEvent.type(screen.getByLabelText('Name F-2'), 'Create and find a book');
  await userEvent.click(screen.getByRole('button', { name: 'Save plan and check' }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryPlan: [
        expect.objectContaining({ id: 'F-2', title: 'Create and find a book', dependsOn: [] }),
        first,
      ],
    }),
  );
  expect(close).toHaveBeenCalled();
});

test('new features require ownership and a usable outcome before they can be saved', async () => {
  const save = vi.fn();
  render(<DeliveryPlanEditor product={product} busy={false} onSave={save} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Add feature' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save plan and check' }));
  expect(screen.getByRole('alert')).toHaveTextContent('at least one requirement');
  expect(save).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Outcome F-3'), 'A complete flow.');
  await userEvent.type(screen.getByLabelText('Rationale F-3'), 'Next independent value.');
  await userEvent.selectOptions(screen.getByLabelText('Type F-3'), 'platform');
  await userEvent.selectOptions(screen.getByLabelText('Feature for REQ-2'), 'F-3');
  await userEvent.click(screen.getByRole('button', { name: 'Save plan and check' }));
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(screen.getAllByRole('button', { name: 'Remove empty feature' })[1]!);
  await userEvent.click(screen.getByRole('button', { name: 'Save plan and check' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Shared platform work needs a test plan');
  expect(save).not.toHaveBeenCalled();
  await userEvent.type(
    screen.getByLabelText('Test plan F-3'),
    'Exercise book creation through the store, assert persisted reads and denied access.',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save plan and check' }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryPlan: [
        first,
        expect.objectContaining({ requirementIds: ['REQ-2'], kind: 'platform' }),
      ],
    }),
  );
});

test('progress preserves order, differentiates evidence, and does not compare changed scope', () => {
  expect(featureProgress(product, new Map())[1]?.waitingOn).toEqual(['Browse books']);
  expect(featureProgress(product, new Map([['REQ-1', done]]))[1]?.waitingOn).toEqual([]);
  expect(featureProgress(product, new Map([['REQ-1', done]]))[0]?.complete).toBe(true);
  expect(featureProgress(report.baseline, new Map())).toEqual([]);
  expect(orderedPlan([second, first])).toBe(false);
  expect(orderedPlan([first, second])).toBe(true);
  expect(progressChange(report, null)).toContain('next check');
  expect(progressChange(report, { ...report, id: 'prior', baselineId: 'old' })).toContain(
    'Scope changed',
  );
  expect(
    progressChange(report, {
      ...report,
      id: 'prior',
      assessments: report.assessments.map((a) => ({ ...a, status: 'implemented' })),
    }),
  ).toContain('2 regressed');
  expect(
    progressChange(
      { ...report, assessments: report.assessments.map((a) => ({ ...a, status: 'implemented' })) },
      { ...report, id: 'prior' },
    ),
  ).toContain('2 newly built');
  const facts = {
    code: 'implemented' as const,
    main: undefined,
    edges: [],
    openCalls: 0,
    method: undefined,
  };
  expect(requirementState(facts).label).toBe('Built');
  expect(requirementState({ ...facts, manualConfirmed: true })).toMatchObject({
    label: 'Done',
    tone: 'manual',
  });
  expect(requirementState({ ...facts, manualConfirmed: true, expectedEdges: 1 }).label).toBe(
    'Needs verification',
  );
  expect(
    requirementState({ ...facts, manualConfirmed: true, expectedEdges: 1, confirmedEdgeCount: 1 })
      .label,
  ).toBe('Done');
  expect(requirementState({ ...facts, method: 'code' }).label).toBe('Done');
  expect(
    requirementState({ ...facts, main: { verdict: 'pass' } as never, expectedEdges: 2 }).label,
  ).toBe('Needs verification');
});

test('scope edits retain existing ownership and explicitly place new requirements in added scope', () => {
  expect(reconcilePlan(report.baseline)).toEqual(report.baseline);
  const updated = reconcilePlan({
    ...product,
    requirements: [...product.requirements, { id: 'REQ-3', text: 'Delete books.' }],
  });
  expect(updated.deliveryPlan?.slice(0, 2)).toEqual([first, second]);
  expect(updated.deliveryPlan?.at(-1)?.requirementIds).toEqual(['REQ-3']);
  const removed = reconcilePlan({ ...product, requirements: [product.requirements[1]!] });
  expect(removed.deliveryPlan).toEqual([{ ...second, dependsOn: [] }]);
});

test('a blocking decision pauses its feature, dependents wait on it, and tickets say which', async () => {
  f.reset();
  f.setReport({ ...report, baseline: product });
  f.setCalls([
    {
      id: 'blocker',
      kind: 'decision',
      status: 'open',
      requirementId: 'REQ-1',
      edgeCaseId: null,
      question: 'Who can browse this library?',
      assumption: 'Library access and dependent editing wait for the visibility policy.',
      options: [],
      owner: 'you',
      blocking: true,
      answer: null,
      askedAt: report.generatedAt,
      answeredAt: null,
      runId: report.id,
    },
  ]);
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: copy } });
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  const browse = await screen.findByRole('region', { name: 'Browse books' });
  const create = screen.getByRole('region', { name: 'Create books' });
  expect(browse).toHaveTextContent('Waiting on 1 decision. This requirement and dependent work');
  expect(create).toHaveTextContent('Waiting on prerequisites');
  expect(create).not.toHaveTextContent('Blocked by a decision');
  expect(screen.queryByRole('button', { name: 'Copy work item' })).not.toBeInTheDocument();
  expect(
    screen.getByText('Delivery paused: resolve blocking decisions in Needs you.'),
  ).toBeVisible();
  await userEvent.click(within(create).getByRole('heading', { name: 'F-2 Create books' }));
  const row = within(create).getByText(/Users can create books/, { selector: '.row-title' });
  expect(row.closest('details')).toHaveTextContent('Waiting');
  await userEvent.click(row);
  await userEvent.click(within(create).getByRole('button', { name: 'Copy ticket' }));
  const ticket = copy.mock.calls[0]?.[0] as string;
  expect(ticket).toContain('## Waiting on a prerequisite decision');
  expect(ticket).toContain('F-1 Browse books needs a decision first: Who can browse this library?');
  expect(ticket).toContain('Dependencies: F-1');
  expect(ticket).not.toContain('## Known remaining work');
  expect(ticket).not.toContain('dependent editing wait');
});

test('project tabs keep history out of the overview and support keyboard navigation', async () => {
  f.reset();
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  const overview = screen.getByRole('tab', { name: 'Overview' });
  expect(overview).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Overview');
  expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Coding' })).toBeNull();
  overview.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Scope' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Edit scope' })).toBeVisible();
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Activity');
  expect(screen.getByRole('region', { name: 'Activity' })).toBeVisible();
  await userEvent.keyboard('{Home}{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus();
  await userEvent.click(overview);
  expect(screen.getByRole('region', { name: 'Status' })).toBeVisible();
});

test('passing local code and manual checks cannot count as merged delivery', () => {
  const local = {
    ...report,
    snapshots: report.snapshots.map((s) => ({ ...s, source: 'local' as const })),
    assessments: report.assessments.map((a) => ({
      ...a,
      status: 'implemented' as const,
      deviation: false,
    })),
  };
  const facts = requirementFacts(local, null, [], { 'REQ-1': local.id }).get('REQ-1')!;
  expect(requirementState(facts).label).toBe('Branch unverified');
  expect(requirementState({ ...facts, manualConfirmed: false, method: 'code' }).label).toBe(
    'Branch unverified',
  );
  const legacy = {
    ...local,
    snapshots: local.snapshots.map((s) => ({ ...s, source: undefined, checkedAt: undefined })),
  };
  expect(requirementFacts(legacy, null, []).get('REQ-1')?.remoteVerified).toBe(false);
});

test('a decision on a later step keeps the current focus and says other steps are waiting', async () => {
  f.reset();
  f.setReport({ ...report, baseline: product });
  f.setCalls([
    {
      id: 'later',
      kind: 'decision',
      status: 'open',
      requirementId: 'REQ-2',
      edgeCaseId: null,
      question: 'May readers delete books?',
      assumption: 'Editing waits for the deletion policy.',
      options: [],
      owner: 'you',
      blocking: true,
      answer: null,
      askedAt: report.generatedAt,
      answeredAt: null,
      runId: report.id,
    },
  ]);
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Synthetic books' }));
  const status = await screen.findByRole('region', { name: 'Status' });
  expect(status).toHaveTextContent('Current focus: Browse books.');
  expect(status).toHaveTextContent('Other steps wait on decisions in Needs you.');
  expect(status).not.toHaveTextContent('Delivery paused');
});
