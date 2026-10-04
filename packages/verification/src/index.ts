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

/** Start one headless Chromium for a run; each criterion attempt gets its own fresh context. */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    throw new Error(
      'Aiden could not start its test browser. Run "pnpm exec playwright install chromium" and try again.',
    );
  }
}
