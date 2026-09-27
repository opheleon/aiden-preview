import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { z } from 'zod/v3';

import { outputSchemaFor, type RunManifest } from '../../contracts/src/index.js';
import { ArtifactFormatError, publicError, type RuntimeResult } from '../../runtimes/src/index.js';
import type { LocalToolServer } from '../../tools/src/mcp.js';
import { atomic, optionalJson } from './storage.js';
import type { WorkflowContext } from './workflow-context.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = sourceRoot.endsWith('/dist') ? path.dirname(sourceRoot) : sourceRoot;

/** Stage dependencies keep runtime calls, checkpoint paths, and progress scoped to one run. */
interface ModelStageOptions {
  context: WorkflowContext;
  run: RunManifest;
  signal: AbortSignal;
  dir: string;
  workspace: string;
  tools: LocalToolServer;
  includeAnswers?: boolean;
  onStage?: (name: string, validate: (value: unknown) => unknown) => Promise<void>;
}

/** Typed validator boundary shared by report and estimate stages; stored output is revalidated on resume. */
export interface ModelStage {
  <T>(
    name: string,
    schema: z.ZodType<T>,
    input: unknown,
    validate: (value: unknown) => T,
  ): Promise<T>;
}

/** Retry only invalid model output; transport, cancellation, and storage failures never submit another turn. */
export function createModelStage(options: ModelStageOptions): ModelStage {
  const { context, run, signal, dir, workspace, tools } = options;
  /** Reuse a validated checkpoint or accept at most three provider outputs for this stage. */
  return async function stage<T>(
    name: string,
    schema: z.ZodType<T>,
    input: unknown,
    validate: (value: unknown) => T,
  ): Promise<T> {
    signal.throwIfAborted();
    const saved = await optionalJson<unknown>(path.join(dir, `${name}.json`));
    if (saved !== null) return validate(saved);
    await options.onStage?.(name, validate);
    const instructions = await readFile(path.join(root, 'workflows/v1', `${name}.md`), 'utf8');
    let feedback = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const answers = options.includeAnswers
        ? `\n<prior_user_answers>${JSON.stringify((await optionalJson(path.join(dir, 'answers.json'))) ?? [])}</prior_user_answers>`
        : '';
      let result: RuntimeResult;
      try {
        result = await context.runtime.run({
          config: run.project.runtime,
          prompt: `${instructions}\n<input_data>\n${JSON.stringify(input)}\n</input_data>${answers}\n<validation_feedback>${feedback}</validation_feedback>\nReturn ONLY the JSON object matching this schema:\n${JSON.stringify(outputSchemaFor(schema))}`,
          schema: outputSchemaFor(schema),
          cwd: workspace,
          tools,
          signal,
          progress: (message) =>
            context.emit({
              type: 'progress',
              runId: run.id,
              projectId: run.projectId,
              stage: run.stage,
              message,
            }),
        });
      } catch (error) {
        if (!(error instanceof ArtifactFormatError)) throw error;
        feedback = publicError(error);
        continue;
      }
      signal.throwIfAborted();
      run.runtimeVersion = result.version;
      const model = result.model ?? run.project.runtime.model;
      if (model !== undefined) run.runtimeModel = model;
      else delete run.runtimeModel;
      let parsed: T;
      try {
        parsed = validate(result.value);
      } catch (error) {
        feedback = publicError(error);
        context.emit({
          type: 'progress',
          runId: run.id,
          projectId: run.projectId,
          stage: run.stage,
          message: `Output needs correction (${attempt + 1}/3): ${feedback}`,
        });
        continue;
      }
      // Persistence is outside correction handling: retrying a paid turn cannot repair a disk failure.
      await atomic(path.join(dir, `${name}.json`), parsed, signal);
      await atomic(path.join(dir, 'manifest.json'), run, signal);
      return parsed;
    }
    throw new Error(`${name} output failed validation after two correction attempts.`);
  };
}
