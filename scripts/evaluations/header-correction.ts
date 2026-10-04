import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Project, RuntimeConfig } from '../../packages/contracts/src/index.js';
import { Engine } from '../../packages/core/src/engine.js';
import { atomic } from '../../packages/core/src/storage.js';

const exec = promisify(execFile);
export const correction =
  'The Projects panel must stay. Remove only the redundant Projects text label in the top header, preserving the Projects navigation button.';

/** Create a synthetic local repository and an unrelated API, never touching an existing project. */
export async function headerScenario(runtime: RuntimeConfig): Promise<{
  root: string;
  project: Project;
  sha: string;
  port: number;
  close: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'aiden-header-eval-'));
  const repo = path.join(root, 'aiden');
  await mkdir(repo);
  await writeFile(
    path.join(repo, 'README.md'),
    '# Aiden desktop\nAn Electron project with a header and Projects sidebar. This is a synthetic evaluation repository.\n',
  );
  await writeFile(
    path.join(repo, 'ApplicationHeader.tsx'),
    `export function ApplicationHeader() {
  return <header>
    <button onClick={() => location.assign('#projects')}>Projects</button>
    <span className="app-nav">Projects</span>
  </header>;
}
`,
  );
  await writeFile(
    path.join(repo, 'WorkspaceSidebar.tsx'),
    `export function WorkspaceSidebar() {
  return <aside aria-label="Projects"><a href="#project-1">Example project</a></aside>;
}
`,
  );
  await exec('git', ['-c', 'init.defaultBranch=main', 'init', repo]);
  const gitOptions = {
    cwd: repo,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  };
  await exec('git', ['add', '.'], gitOptions);
  await exec(
    'git',
    [
      '-c',
      'user.name=Evaluation',
      '-c',
      'user.email=eval@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-m',
      'Synthetic header before removal',
    ],
    gitOptions,
  );
  const sha = (await exec('git', ['rev-parse', 'HEAD'], gitOptions)).stdout.trim();
  const project: Project = {
    id: 'header-correction',
    name: 'Synthetic header correction',
    context: 'I want to get rid of the Projects in the middle of the screen in the Aiden app.',
    repositories: [{ id: 'aiden', path: repo, notes: 'The Aiden desktop app is the target.' }],
    runtime,
  };
  const api = createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'Missing Authorization header' }));
  });
  await new Promise<void>((resolve, reject) => {
    api.once('error', reject);
    api.listen(0, '127.0.0.1', resolve);
  });
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('Missing API fixture port.');
  return {
    root,
    project,
    sha,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        api.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Seed the known bad interpretation; all rewriting and assessment that follows uses the live model. */
export async function seedMisunderstanding(engine: Engine, project: Project): Promise<void> {
  await atomic(path.join(engine.store.project(project.id), 'project.json'), project);
  await engine.editProduct(project.id, {
    overview: 'Remove the Projects panel from the middle of the main screen.',
    requirements: [
      {
        id: 'REQ-1',
        text: 'The main screen no longer displays the Projects panel/list.',
        edgeCases: [
          { id: 'E1', text: 'No empty gap remains where the Projects panel was.', origin: 'scope' },
        ],
      },
    ],
    milestones: [],
  });
}

/** Wait for the production chain, preserving failures and enforcing a total attempt deadline. */
export async function waitForChain(
  engine: Engine,
  projectId: string,
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    const runs = await engine.history(projectId);
    const failed = runs.find((run) => ['failed', 'cancelled'].includes(run.status));
    if (failed) throw new Error(`${failed.kind}: ${failed.error ?? failed.status}`);
    if (
      runs.some((run) => run.kind === 'estimate' && run.status === 'completed') &&
      !engine.isBusy(projectId)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Evaluation exceeded its five-minute attempt budget.');
}
