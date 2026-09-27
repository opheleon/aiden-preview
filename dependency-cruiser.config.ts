import type { IConfiguration } from 'dependency-cruiser';
/** Runtime cycles and renderer privilege crossings are build failures; type-only edges are excluded. */
export default {
  forbidden: [
    {
      name: 'renderer-no-electron-or-main',
      severity: 'error',
      from: { path: '^apps/desktop/src/((?:App|entry)\\.tsx|components/|views/|hooks/|renderer/)' },
      to: {
        path: '(^|/)electron(/|$)|^apps/desktop/src/(main|desktop-ipc|worker-ipc|diagnostics|updater|update-service|scheduler)\\.ts$',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-runtime-cycles',
      severity: 'error',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'renderer-no-privileged-packages',
      severity: 'error',
      from: { path: '^apps/desktop/src/((?:App|entry)\\.tsx|components/|views/|hooks/|renderer/)' },
      to: {
        path: '^packages/(core|runtimes|integrations|tools)/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'renderer-no-node',
      severity: 'error',
      from: { path: '^apps/desktop/src/((?:App|entry)\\.tsx|components/|views/|hooks/|renderer/)' },
      to: { dependencyTypes: ['core'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'apps/desktop/tsconfig.json' },
  },
} satisfies IConfiguration;
