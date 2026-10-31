import state from '../../packages/contracts/fixtures/accounts/account-state.json';
import type { AccountState, AccountTask } from '../../packages/contracts/src/accounts-api';
import type { AccountStatus } from '../../packages/contracts/src/api';

/**
 * A team whose agent finished work for Bob to review and verify. Synthetic data shaped like the
 * server's task view; never live agent output.
 */
export const bob = state.members.find((m) => m.email === 'bob@example.com')!;
const agent = state.tasks.find((t) => t.actor === 'agent')! as unknown as AccountTask;
const human = state.tasks.find((t) => t.actor === 'human')! as unknown as AccountTask;

/** A reviewed build with two pull requests, a long title, and a long repository name. */
export const reviewTask: AccountTask = {
  ...agent,
  id: 'review-1',
  kind: 'build',
  title:
    'Build: Members sign in with their work email and see private calendar events across every connected workspace',
  status: 'review',
  role: 'fe_engineer',
  reviewerUserId: bob.id,
  review: {
    summary:
      'Aiden checked the pull requests: 1 of 2 requirements met.\nREQ-1: Implemented\nREQ-2: Partly implemented. Still needed: refuse expired invites\n\nAdded sign-in to the API and a login page.',
    pullRequestUrls: [
      'https://github.com/acme/calendar-api/pull/12',
      'https://github.com/acme/calendar-web-frontend-with-a-very-long-repository-name/pull/7',
    ],
  },
  checks: [
    {
      id: '1',
      name: 'CI: acme/calendar-api#12',
      kind: 'automated',
      state: 'pending',
      detail: null,
      url: 'https://github.com/acme/calendar-api/pull/12',
    },
    {
      id: '2',
      name: 'REQ-1: Members sign in with their work email',
      kind: 'automated',
      state: 'passed',
      detail: null,
      url: null,
    },
    {
      id: '3',
      name: 'REQ-2: Expired invites are refused with a clear message that names the team and the person who sent the invite',
      kind: 'manual',
      state: 'pending',
      detail:
        'Partly implemented. Still needed: refuse expired invites. The invite endpoint accepts any code without checking its expiry date, so an old link still signs someone in.',
      url: null,
    },
  ],
};

/** The same work after approval: CI passed, and one manual check waits for Bob. */
export const verifyTask: AccountTask = {
  ...reviewTask,
  id: 'verify-1',
  title: 'Build: Recurring events',
  status: 'verify',
  checks: [
    {
      id: '1',
      name: 'CI: acme/calendar-api#13',
      kind: 'automated',
      state: 'passed',
      detail: '3 checks passed',
      url: 'https://github.com/acme/calendar-api/pull/13',
    },
    { ...reviewTask.checks[2]!, id: '2' },
  ],
};

/** A legacy pull request review from before review packets; it still finishes with Mark done. */
export const legacyReview: AccountTask = {
  ...human,
  id: 'legacy-1',
  kind: 'review-pr',
  title: 'Review and merge the pull request',
  instructions: 'Built it\nhttps://github.com/acme/calendar-api/pull/9',
  assigneeUserId: null,
};

/** The team state with these tasks, plus someone else's review that Bob must not see. */
export function reviewState(): AccountState {
  const other = { ...reviewTask, id: 'review-2', title: 'Alice reviews this', reviewerUserId: 'x' };
  return {
    ...(state as unknown as AccountState),
    tasks: [reviewTask, verifyTask, legacyReview, other],
  };
}

/** Bob, signed in, with his agent ready for team work. */
export function bobStatus(): AccountStatus {
  return {
    signedIn: true,
    email: bob.email,
    userId: bob.id,
    accounts: [{ id: state.account.id, name: state.account.name }],
    message: null,
    deviceName: 'Bob MacBook',
    pickupEnabled: true,
    usageCapPct: 70,
    signingIn: false,
    running: null,
    last: null,
  };
}
