import type { Project, RepositoryDiscovery } from '../../../../packages/contracts/src/index';

/** Every folder the person connected to a project, first folder first. */
export function projectFolders(
  project: Pick<Project, 'rootPath' | 'additionalRootPaths'>,
): string[] {
  return [project.rootPath, ...(project.additionalRootPaths ?? [])].filter(
    (folder): folder is string => !!folder,
  );
}

/** Whether a repository path sits in a folder, by whole path segments on any platform. */
function inside(folder: string, location: string): boolean {
  const separator = folder.includes('\\') ? '\\' : '/';
  const root = folder.endsWith(separator) ? folder : `${folder}${separator}`;
  return location === folder || location.startsWith(root);
}

/**
 * Add one scanned folder to a project, or replace them all, keeping notes and branches on
 * repositories that were already listed. A folder scanned again replaces only its own repositories.
 * Example: adding ~/api to a project that has ~/web lists the repositories of both.
 */
export function withFolder(
  project: Project,
  found: RepositoryDiscovery,
  mode: 'add' | 'replace',
): Project {
  const folders =
    mode === 'replace'
      ? [found.rootPath]
      : [...projectFolders(project).filter((folder) => folder !== found.rootPath), found.rootPath];
  const kept =
    mode === 'replace'
      ? []
      : project.repositories.filter((repo) => !inside(found.rootPath, repo.path));
  const scanned = found.repositories
    .filter((repo) => !kept.some((existing) => existing.path === repo.path))
    .map((repo) => project.repositories.find((existing) => existing.path === repo.path) ?? repo);
  const [rootPath, ...additional] = folders;
  return {
    ...project,
    ...(rootPath ? { rootPath } : {}),
    additionalRootPaths: additional,
    discoveryWarnings: found.warnings,
    repositories: [...kept, ...scanned],
  };
}

/** Remove one folder and the repositories found in it; the next folder becomes the first. */
export function withoutFolder(project: Project, folder: string): Project {
  const [rootPath, ...additional] = projectFolders(project).filter((item) => item !== folder);
  const next: Project = {
    ...project,
    additionalRootPaths: additional,
    repositories: project.repositories.filter((repo) => !inside(folder, repo.path)),
  };
  if (rootPath) next.rootPath = rootPath;
  else delete next.rootPath;
  return next;
}
