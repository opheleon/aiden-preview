import path from 'node:path';

import { startAuthDemo } from './local-auth-demo/server.js';

const app = await startAuthDemo(path.resolve('.aiden/local-auth-demo'), 4317);
process.stdout.write(
  `Local authentication test app: ${app.origin}/login\nSetup app URL: ${app.origin}/app\nAPI base URL: ${app.origin}/api/\nDisposable account details: docs/local-auth-demo.md\n`,
);
/** Shut down the local server and close SQLite cleanly. */
async function stop(): Promise<void> {
  await app.close();
  process.exit(0);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
