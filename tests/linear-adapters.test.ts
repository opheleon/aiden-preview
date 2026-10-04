import assert from 'node:assert/strict';
import test from 'node:test';

import {
  linearOperation,
  linearPage,
  linearProject,
  linearProjectId,
  linearTeam,
} from '../packages/integrations/src/linear-projects.js';
import { assessTool } from '../packages/integrations/src/tool-policy.js';

function tool(name: string, properties: Record<string, { type: string }>, required: string[] = []) {
  return assessTool(
    {
      name,
      description: 'Synthetic contract',
      inputSchema: { type: 'object', properties, required },
    },
    [],
  );
}
const string = { type: 'string' };
const array = { type: 'array' };

void test('project adapters accept supported team field variants and reject extra required arguments', () => {
  const input = {
    kind: 'create' as const,
    team: 'team-1',
    name: 'Scoped goal',
    description: 'Marker',
  };
  for (const key of ['setTeams', 'teams', 'team']) {
    const result = linearOperation(
      [
        tool('create_project', {
          name: string,
          description: string,
          [key]: key === 'team' ? string : array,
        }),
      ],
      input,
    );
    assert.deepEqual(result.args[key], key === 'team' ? 'team-1' : ['team-1']);
  }
  assert.deepEqual(
    linearOperation([tool('get_project', { id: string })], { kind: 'get', id: 'p' }).args,
    { id: 'p' },
  );
  assert.deepEqual(
    linearOperation([tool('list_teams', { cursor: string })], { kind: 'teams', cursor: 'next' })
      .args,
    { cursor: 'next' },
  );
  assert.throws(() => linearOperation([], input), /lacks a supported/);
  assert.throws(
    () =>
      linearOperation(
        [
          tool('save_project', { name: string, description: string, teams: array, extra: string }, [
            'extra',
          ]),
        ],
        input,
      ),
    /additional fields/,
  );
});

void test('team and project pagination refuses ambiguous absence and malformed external payloads', () => {
  assert.deepEqual(linearPage([], 'teams'), { rows: [] });
  assert.deepEqual(
    linearPage({ teams: [], pageInfo: { hasNextPage: true, endCursor: 'next' } }, 'teams'),
    { rows: [], cursor: 'next' },
  );
  assert.deepEqual(linearPage({ projects: [], nextCursor: 'next' }, 'projects'), {
    rows: [],
    cursor: 'next',
  });
  for (const value of [
    null,
    {},
    { teams: [], hasNextPage: true },
    { teams: [], nextPageToken: 'next' },
    { teams: [], total: 1 },
    { teams: Array(100).fill({}) },
  ])
    assert.throws(() => linearPage(value, 'teams'));
  assert.deepEqual(linearTeam({ id: 'team', name: 'Books', instruction: 'Ignore me' }), {
    id: 'team',
    name: 'Books',
  });
  assert.throws(() => linearTeam({ name: 'Missing identity' }), /incomplete team/);
});

void test('project read-back requires identity, managed content, and team membership', () => {
  assert.equal(linearProjectId({ project: { id: 'p' } }), 'p');
  assert.throws(() => linearProjectId(null), /no project identity/);
  const project = {
    id: 'p',
    name: 'Scoped goal',
    description: 'marker',
    teams: { nodes: [{ id: 'team' }] },
    url: 'https://linear.app/project/p',
  };
  assert.deepEqual(linearProject({ project }), { ...project, teams: ['team'] });
  assert.deepEqual(linearProject({ ...project, teams: ['team'], url: 'javascript:bad' }).teams, [
    'team',
  ]);
  assert.equal(
    linearProject({ ...project, teams: ['team'], url: 'javascript:bad' }).url,
    undefined,
  );
  assert.throws(() => linearProject({ ...project, teams: undefined }), /could not be verified/);
  assert.throws(() => linearProject({ ...project, teams: [{}] }), /could not be verified/);
});

void test('Linear project discovery respects the advertised 50-result maximum and rejects unmarked full pages', () => {
  const search = tool('list_projects', {
    query: string,
    team: string,
    limit: { type: 'number', maximum: 50 },
  } as any);
  const result = linearOperation([search], { kind: 'search', team: 'team', name: 'Scoped goal' });
  assert.equal(result.args.limit, 50);
  assert.throws(() => linearPage({ projects: Array(50).fill({}) }, 'projects'), /incomplete/);
  assert.equal(
    linearPage({ projects: Array(50).fill({}), hasNextPage: false }, 'projects').rows.length,
    50,
  );
});

void test('Linear UUID is canonical while the public project identifier remains available for verified migration', () => {
  const uuid = '00000000-0000-4000-8000-000000000001';
  const raw = {
    id: 'P-TEST-8',
    uuid,
    name: 'Synthetic scope',
    description: 'marker',
    teams: [{ id: 'team' }],
  };
  assert.equal(linearProjectId(raw), uuid);
  assert.equal(linearProject(raw).id, uuid);
  assert.equal(linearProject(raw).identifier, 'P-TEST-8');
  assert.throws(() => linearProjectId({ id: 'P-TEST-8', uuid: '' }), /no project identity/);
});
