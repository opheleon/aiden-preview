import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Resolve the packaged browser before importing Playwright, which reads this path on import.
assert.ok(process.argv[2], 'Pass the packaged Playwright resources directory.');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(process.argv[2]);
const { chromium } = await import('playwright');
const root = await mkdtemp(path.join(tmpdir(), 'aiden-packaged-browser-'));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ recordVideo: { dir: root } });
  const page = await context.newPage();
  await page.setContent('<h1>Packaged browser works</h1>');
  assert.equal(await page.locator('h1').textContent(), 'Packaged browser works');
  assert.ok((await page.screenshot()).length > 0);
  const video = page.video();
  assert.ok(video);
  await context.close();
  assert.ok((await stat(await video.path())).size > 0, 'The bundled encoder must record video.');
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
