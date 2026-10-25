import { type Browser, chromium } from 'playwright';

export { ApiHttp } from './api-http.js';
export { ApiSession } from './api-session.js';
export { betaTarget, betaUrl, deployedRevision } from './beta.js';
export { BrowserSession, type SessionOptions } from './browser.js';
export { appPorts, discoverLocalApps, type DiscoverOptions } from './discover.js';
export {
  isLocalHost,
  loadVerificationConfig,
  parseApiUrl,
  parseAppUrl,
  redactor,
  settingsFile,
  verificationTarget,
} from './policy.js';
export { ProofViewer } from './proof-viewer.js';
export { plainText, renderReport } from './report.js';
export {
  criterionResult,
  judgeAttempt,
  reasonLabels,
  reviewableProof,
  shouldRetry,
  summarize,
} from './verdict.js';

/**
 * Start one headless Chromium for a run; each criterion attempt gets its own fresh context.
 * Playwright disables Chromium's OS sandbox unless asked, so pages under test stay sandboxed here.
 */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, chromiumSandbox: true });
  } catch {
    throw new Error(
      process.env.AIDEN_PACKAGED === '1'
        ? 'Aiden could not start its included test browser. Reopen Aiden or reinstall the latest version and try again.'
        : 'Aiden could not start its test browser. Run "pnpm exec playwright install chromium" and try again.',
    );
  }
}
