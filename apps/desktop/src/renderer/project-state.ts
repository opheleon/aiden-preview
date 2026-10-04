import type { Project } from '../../../../packages/contracts/src/index';
/** Create an unsaved local project using subscription authentication and no source access. */
export const newProject = (): Project => ({
  id: crypto.randomUUID(),
  name: '',
  context: '',
  repositories: [],
  runtime: { provider: 'codex', auth: 'subscription' },
});
