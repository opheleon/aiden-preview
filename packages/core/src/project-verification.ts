import type { ProjectDeviceTest } from '../../contracts/src/device-verification.js';
import type { RunManifest } from '../../contracts/src/index.js';
import { appendActivity } from './activity.js';
import type { Engine } from './engine.js';
import { verifyProjectDevice } from './project-device.js';
import { readAppUrl } from './verification-settings.js';

/** Execute configured surfaces after accepted code assessment, preserving sizing when a target fails. */
export async function verifyConfiguredSurfaces(
  engine: Engine,
  run: RunManifest,
  requested: boolean,
  explicitPhone?: ProjectDeviceTest,
): Promise<void> {
  const settings = await readAppUrl(engine, run.projectId).catch(async () => {
    await appendActivity(engine, run, {
      kind: 'result',
      summary: 'Could not read verification configuration. Code assessment is preserved.',
    });
    return null;
  });
  if (!settings) return;
  const enabled = requested || settings.trigger === 'after_assessment';
  const browserConfigured = Boolean(settings.url || settings.api);
  if (enabled && browserConfigured && !(await verifyBrowserSurfaces(engine, run))) return;
  const phone = explicitPhone ?? (enabled ? settings.phone : undefined);
  if (phone) await verifyProjectDevice(engine, run, phone);
  if (requested && !browserConfigured && !phone)
    await appendActivity(engine, run, {
      kind: 'result',
      summary: 'Code assessed. No app surfaces are configured for verification.',
      reason: 'Choose the surfaces and connection details in this project’s verification settings.',
    });
}

/** Start browser/API verification independently so an unavailable target does not suppress phone checks. */
async function verifyBrowserSurfaces(engine: Engine, run: RunManifest): Promise<boolean> {
  try {
    const current = await engine.state(run.projectId);
    if (current.baseline?.id !== run.baseline?.id)
      throw new Error('Requirements changed before verification.');
    const started = await engine.verify(run.projectId, undefined, run.reason);
    await engine.wait(started.runId);
    const finished = (await engine.state(run.projectId)).runs.find(
      (item) => item.id === started.runId,
    );
    return finished?.status !== 'cancelled';
  } catch {
    await appendActivity(engine, run, {
      kind: 'result',
      summary: 'Browser/API verification could not start. Code assessment is preserved.',
      reason: 'Review the project verification configuration and available test environment.',
    });
    return true;
  }
}
