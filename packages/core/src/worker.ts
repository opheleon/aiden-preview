import path from 'node:path';
import { createInterface } from 'node:readline';

import { Runtimes } from '../../runtimes/src/index.js';
import { appPorts } from '../../verification/src/index.js';
import { Engine } from './engine.js';
import { Store } from './storage.js';
import { createMethods } from './worker-methods.js';
import { dispatchWorkerLine } from './worker-protocol.js';

const store = new Store();
const runtimes = new Runtimes(path.join(store.root, 'providers'));
/** Emit one JSON envelope; protocol output must never contain diagnostic logging. */
function send(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + '\n');
}
const engine = new Engine(store, runtimes, (event) => send({ event }));
const ports = appPorts(process.env.AIDEN_APP_PORTS);
if (ports) engine.discover = { ports };
export const methods = createMethods(engine, runtimes);
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  void dispatchWorkerLine(line, methods).then(send);
});
let closing = false;
/** Stop active work and preserve its checkpoint before terminating the worker process. */
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await engine.dispose();
  } finally {
    process.exit(0);
  }
}
input.on('close', () => void close());
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
