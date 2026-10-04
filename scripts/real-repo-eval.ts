import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod/v3';

import {
  ProductSchema,
  type Project,
  type Report,
  type RunManifest,
} from '../packages/contracts/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { atomic, json, Store } from '../packages/core/src/storage.js';
import { Runtimes } from '../packages/runtimes/src/index.js';
const exec = promisify(execFile);
const specification = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    source: z.string().url(),
    pullRequest: z.string().url(),
    base: z.string().regex(/^[a-f0-9]{40}$/),
    head: z.string().regex(/^[a-f0-9]{40}$/),
    product: ProductSchema,
    expected: z.record(z.record(z.enum(['implemented', 'missing', 'partial', 'unknown']))),
    reviewNotes: z.string(),
  })
  .strict()
  .parse(
    JSON.parse(await readFile(process.argv[2] || 'examples/evaluations/p-queue-233.json', 'utf8')),
  );
const provider = process.argv.includes('--claude') ? 'claude' : 'codex';
const root = await mkdtemp(path.join(tmpdir(), `aiden-real-${specification.id}-`));
const store = new Store(path.join(root, 'data'));
const runtime = new Runtimes(path.join(root, 'providers'));
// Calls never block a run: the model records its assumption and proceeds, so no answers are needed.
const engine = new Engine(store, runtime, (event) => {
  console.log(
    JSON.stringify({
      type: event.type,
      stage: event.stage,
      runId: event.runId,
      ...(event.activity?.kind === 'ask' ? { ask: event.activity.summary } : {}),
    }),
  );
});
const results: {
  phase: 'base' | 'head';
  sha: string;
  runtime: Report['runtime'];
  report: string;
  assessments: {
    id: string;
    status: Report['assessments'][number]['status'];
    expected: string | undefined;
    matches: boolean;
    evidence: Report['assessments'][number]['evidence'];
  }[];
}[] = [];
try {
  const diagnostics = await runtime.diagnostics();
  const available = diagnostics.find((d) => d.provider === provider)?.subscription;
  if (!available)
    throw new Error(`${provider} subscription unavailable; no live assessment was run.`);
  for (const phase of ['base', 'head'] as const) {
    const repo = path.join(root, phase, 'p-queue');
    await mkdir(repo, { recursive: true });
    /** Run Git against the isolated benchmark snapshot with hooks disabled and a bounded timeout. */
    const git = (...args: string[]) =>
      exec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
        cwd: repo,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      });
    await git('init', '-q');
    await git(
      'fetch',
      '--depth=1',
      '--no-tags',
      `https://github.com/${specification.repository}.git`,
      specification[phase],
    );
    await git('checkout', '--detach', 'FETCH_HEAD');
    if ((await git('rev-parse', 'HEAD')).stdout.trim() !== specification[phase])
      throw new Error('Snapshot identity mismatch.');
    // Each checkout contains only its selected commit, with no future branch refs or writable upstream.
    const project: Project = {
      id: `${specification.id}-${phase}`,
      name: `Real repository evaluation: ${specification.id} ${phase}`,
      context: JSON.stringify(specification.product),
      repositories: [
        {
          id: 'p-queue',
          path: repo,
          notes:
            'Assess the currently checked-out commit only. Source implementation is under source/; tests are supporting evidence.',
        },
      ],
      runtime: {
        provider,
        auth: 'subscription',
        ...(process.env.AIDEN_SMOKE_MODEL ? { model: process.env.AIDEN_SMOKE_MODEL } : {}),
      },
    };
    const prep = await engine.prepare(project);
    await engine.wait(prep.runId);
    const prepared = await json<RunManifest>(
      path.join(store.run(project.id, prep.runId), 'manifest.json'),
    );
    if (prepared.status !== 'review') throw new Error(prepared.error || 'Preparation failed');
    // Explicit benchmark review uses the authored baseline, not unchecked model extraction.
    await engine.approve(project.id, prep.runId, specification.product);
    const run = await engine.report(project.id);
    await engine.wait(run.runId);
    const manifest = await json<RunManifest>(
      path.join(store.run(project.id, run.runId), 'manifest.json'),
    );
    if (manifest.status !== 'completed') throw new Error(manifest.error || 'Assessment failed');
    const report = await engine.getReport(project.id, run.runId);
    if (report.snapshots.some((s) => s.sha !== specification[phase]))
      throw new Error('Assessment accessed an unintended snapshot.');
    await atomic(path.join(root, `${phase}-report.json`), report);
    await writeFile(
      path.join(root, `${phase}-report.md`),
      await engine.export(project.id, run.runId, 'markdown'),
    );
    results.push({
      phase,
      sha: specification[phase],
      runtime: report.runtime,
      report: path.join(root, `${phase}-report.json`),
      assessments: report.assessments.map((a) => ({
        id: a.requirementId,
        status: a.status,
        expected: specification.expected[phase]?.[a.requirementId],
        matches: a.status === specification.expected[phase]?.[a.requirementId],
        evidence: a.evidence,
      })),
    });
    console.log(
      JSON.stringify({
        phase,
        status: 'completed',
        assessments: results.at(-1)!.assessments.map(({ id, status, expected, matches }) => ({
          id,
          status,
          expected,
          matches,
        })),
      }),
    );
  }
  const passed = results.every((r) => r.assessments.every((a) => a.matches));
  await atomic(path.join(root, 'evaluation.json'), {
    status: passed ? 'passed' : 'mismatch',
    live: true,
    source: specification.source,
    pullRequest: specification.pullRequest,
    recordedAt: new Date().toISOString(),
    results,
  });
  console.log(JSON.stringify({ status: passed ? 'passed' : 'mismatch', live: true, output: root }));
  if (!passed) process.exitCode = 1;
} catch (error) {
  await atomic(path.join(root, 'evaluation.json'), {
    status: 'incomplete',
    live: results.length > 0,
    error: error instanceof Error ? error.message : 'Evaluation failed',
    results,
  });
  console.error(
    JSON.stringify({
      status: 'incomplete',
      error: error instanceof Error ? error.message : 'Evaluation failed',
      output: root,
    }),
  );
  process.exitCode = 1;
} finally {
  await engine.dispose();
}
