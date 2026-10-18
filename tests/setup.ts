// Keep fixture Git operations independent of runner-installed filters and developer settings.
// Repository-local configuration remains visible so tests exercise production safeguards.
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';

// Synthetic OS store: tests never write project credentials into the developer's real keychain.
import { mock } from 'node:test';

import { projectCredentialEntries } from '../packages/verification/src/project-credentials.js';
const credentials = new Map<string, string>();
mock.method(projectCredentialEntries, 'create', (id: string) => ({
  getPassword: () => Promise.resolve(credentials.get(id)),
  setPassword: (value: string) => {
    credentials.set(id, value);
    return Promise.resolve();
  },
  deleteCredential: () => Promise.resolve(credentials.delete(id)),
}));
