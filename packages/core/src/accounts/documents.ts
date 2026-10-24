import path from 'node:path';

import { z } from 'zod/v3';

import type { AccountProject } from '../../../contracts/src/accounts-api.js';
import {
  type Baseline,
  ProductSchema,
  type Project,
  ProjectSchema,
} from '../../../contracts/src/index.js';
import { parseGithubRepository } from '../../../tools/src/github.js';
import type { Engine } from '../engine.js';
import { atomic, optionalJson } from '../storage.js';

/**
 * The project document an account stores on the server: the project as this app saves it plus
 * its accepted baseline. The server treats it as opaque JSON; every member's app reads it here.
 */
const DocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    project: ProjectSchema,
    baseline: z.object({ product: ProductSchema }).passthrough().nullable(),
  })
  .strict();

/** A parsed account project document. */
export type AccountDocument = z.infer<typeof DocumentSchema>;

/** Build the document to upload; machine-local fields (account marker, lifecycle view) stay local. */
export function documentFor(project: Project, baseline: Baseline | null): AccountDocument {
  const shared: Project = { ...project };
  delete shared.account;
  delete shared.lifecycle;
  return { schemaVersion: 1, project: shared, baseline: baseline };
}

/**
 * Keep only repositories cloned from GitHub, placed under this machine's project code folder.
 * A teammate's document can never point this machine at another local folder: entries without a
 * GitHub source are dropped, and the clone path comes from the repository name, not the document.
 */
function localRepositories(engine: Engine, project: Project): Project['repositories'] {
  const codeRoot = path.join(engine.store.project(project.id), 'code');
  return project.repositories.flatMap((repo) => {
    const github = repo.source ? parseGithubRepository(repo.source.name) : null;
    if (!github) return [];
    return [{ ...repo, path: path.join(codeRoot, 'github', github.owner, github.name) }];
  });
}

/**
 * Write a server project into this machine's normal project folder with an account marker, so
 * the engine, the sidebar, and the brief work unchanged. Skips when the local copy is already at
 * this revision or a run is using the project. Returns the local project, or null when the
 * document is not one this version understands.
 */
export async function materialize(
  engine: Engine,
  server: AccountProject,
  force = false,
): Promise<Project | null> {
  const parsed = DocumentSchema.safeParse(server.document);
  if (!parsed.success) return null;
  const folder = engine.store.project(server.id);
  const local = await optionalJson<Project>(path.join(folder, 'project.json'));
  if (!force && local?.account && local.account.revision >= server.revision) return local;
  if (engine.isBusy(server.id)) return local;
  const project: Project = {
    ...parsed.data.project,
    id: server.id,
    account: { accountId: server.accountId, revision: server.revision },
  };
  project.repositories = localRepositories(engine, project);
  delete project.lifecycle;
  await atomic(path.join(folder, 'project.json'), ProjectSchema.parse(project));
  if (parsed.data.baseline) await atomic(path.join(folder, 'baseline.json'), parsed.data.baseline);
  return project;
}

/** Read this machine's copy of an account project and its baseline. */
export async function localDocument(
  engine: Engine,
  projectId: string,
): Promise<{ project: Project; baseline: Baseline | null }> {
  const folder = engine.store.project(projectId);
  const project = ProjectSchema.parse(await optionalJson(path.join(folder, 'project.json')));
  return { project, baseline: await optionalJson<Baseline>(path.join(folder, 'baseline.json')) };
}
