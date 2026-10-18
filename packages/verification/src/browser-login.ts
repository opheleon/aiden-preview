import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';

import type { VerificationConfig } from '../../contracts/src/verification.js';
import { parseAppUrl } from './policy.js';

/** In-memory cookie state passed directly between trusted browser contexts, never to the model. */
export type PrivateBrowserState = Exclude<
  BrowserContextOptions['storageState'],
  string | undefined
>;

/**
 * Sign in privately, requiring the app to deny anonymous access and display usable content in a
 * fresh cookie-only context. Page inspection replaces user-supplied confirmation text. No DOM,
 * screenshots, traces, or credential values leave this function; only reusable session cookies do.
 */
export async function privateBrowserLogin(
  browser: Browser,
  target: URL,
  config: VerificationConfig,
): Promise<PrivateBrowserState> {
  const login = config.webLogin;
  const credentials = config.credentials;
  if (!login || !credentials)
    throw new Error('Enter the private test username and password before checking access.');
  if (
    parseAppUrl(login.loginUrl).origin !== target.origin ||
    (config.credentialOrigin && config.credentialOrigin !== target.origin)
  )
    throw new Error(
      'Sign-in credentials belong to a different app origin. Enter credentials for this app.',
    );
  const context = await privateContext(browser, target);
  try {
    const page = await context.newPage();
    await requireAnonymousSignIn(page, target);
    await context.clearCookies();
    await page.goto(login.loginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const password = page.locator('input[type="password"]:visible');
    const form = page.locator('form').filter({ has: password });
    await form
      .locator('input[autocomplete="username"], input[type="email"]')
      .fill(credentials.username, { timeout: 5000 });
    await password.fill(credentials.password, { timeout: 5000 });
    await form
      .locator('button:not([type]), button[type="submit"], input[type="submit"]')
      .click({ timeout: 5000 });
    await password.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForURL((url) => samePage(url, target), { timeout: 5000 });
    const state = await context.storageState();
    if (!state.cookies.length) throw new Error('No sign-in session cookie was created.');
    const cookies = { cookies: state.cookies, origins: [] };
    await verifyReusableSession(browser, target, cookies);
    return cookies;
  } catch {
    throw new Error(
      'Could not verify sign-in automatically. Check the test account and use an app page that requires sign-in. Aiden must see the app open in a fresh session, without a login, loading, or verification-code screen. MFA and multi-step sign-in need manual setup.',
    );
  } finally {
    await context.close();
  }
}

/** Keep every request and private cookie on the configured app origin, without recording. */
async function privateContext(
  browser: Browser,
  target: URL,
  storageState?: PrivateBrowserState,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    acceptDownloads: false,
    ...(storageState ? { storageState } : {}),
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === target.origin ? route.continue() : route.abort(),
  );
  return context;
}

/** A public page or a tracking cookie cannot establish that the supplied account signed in. */
async function requireAnonymousSignIn(page: Page, target: URL): Promise<void> {
  const response = await page.goto(target.href, {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  });
  if (response && [401, 403].includes(response.status())) return;
  if (!response?.ok()) throw new Error('The app is unavailable.');
  await page.locator('input[type="password"]:visible').first().waitFor({
    state: 'visible',
    timeout: 5000,
  });
}

/** Preserve the selected page, including query and hash routing, when validating session access. */
function samePage(actual: URL, target: URL): boolean {
  return (
    actual.origin === target.origin &&
    actual.pathname === target.pathname &&
    actual.search === target.search &&
    actual.hash === target.hash
  );
}

/** Reopen without the login page's memory or local storage, then inspect the settled rendered DOM. */
async function verifyReusableSession(
  browser: Browser,
  target: URL,
  storageState: PrivateBrowserState,
): Promise<void> {
  const context = await privateContext(browser, target, storageState);
  try {
    const page = await context.newPage();
    const response = await page.goto(target.href, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    if (!response?.ok()) throw new Error('The signed-in page is unavailable.');
    // Let client-side session checks settle before accepting a transient application shell.
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    await page.waitForFunction(signedInPageReady, undefined, { timeout: 5000 });
    if (!samePage(new URL(page.url()), target))
      throw new Error('The app returned to a different page.');
  } finally {
    await context.close();
  }
}

/** Run inside the page: require rendered content and reject login, MFA, error, and loading states. */
function signedInPageReady(): boolean {
  const pending = document.querySelectorAll(
    'input[type="password"], input[autocomplete="one-time-code"], input[name="code" i], input[name*="otp" i], [aria-busy="true"], [role="progressbar"], [aria-invalid="true"]',
  );
  if (
    Array.from(pending).some(
      (element) =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
    )
  )
    return false;
  const headings = Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
    .filter(
      (element) =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
    )
    .map((element) => element.textContent)
    .join(' ');
  const blocked =
    /\b(sign in|log in|verify your identity|verification code|two.factor|access denied|unauthorized|forbidden|something went wrong)\b/i;
  if (blocked.test(headings)) return false;
  const text = document.body.innerText.trim();
  if (!text || /^(loading|please wait|opening|signing in)[.\s…]*$/i.test(text)) return false;
  return Array.from(
    document.querySelectorAll('main, nav, h1, h2, button, a[href], [role="main"]'),
  ).some(
    (element) =>
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden' &&
      !!element.textContent?.trim(),
  );
}
