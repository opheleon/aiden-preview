// Keep fixture Git operations independent of runner-installed filters and developer settings.
// Repository-local configuration remains visible so tests exercise production safeguards.
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';

// Synthetic OS store: tests never write project credentials into the developer's real keychain.
import { mock } from 'node:test';

import { accountSessionEntries } from '../packages/core/src/accounts/session.js';
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

// The Teams session token gets the same synthetic store.
const accountSecrets = new Map<string, string>();
mock.method(accountSessionEntries, 'create', (id: string) => ({
  getPassword: () => Promise.resolve(accountSecrets.get(id)),
  setPassword: (value: string) => {
    accountSecrets.set(id, value);
    return Promise.resolve();
  },
  deleteCredential: () => Promise.resolve(accountSecrets.delete(id)),
}));
