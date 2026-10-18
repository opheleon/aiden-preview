import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { VerificationConfigSchema } from '../packages/contracts/src/verification.js';
import { privateBrowserLogin } from '../packages/verification/src/browser-login.js';
import { launchBrowser } from '../packages/verification/src/index.js';

/** Synthetic HTTP fixture for auth-state edges; real database login is covered in local-auth.test. */
async function loginFixture(mode: string) {
  let submissions = 0;
  const form =
    '<form method="post" action="/login"><label>Email<input type="email" autocomplete="username"></label><label>Password<input type="password"></label><button>Continue</button></form>';
  const content: Record<string, string> = {
    good: '<main><h1>Projects</h1><button>New project</button></main>',
    mfa: '<main><h1>Verify your identity</h1><input autocomplete="one-time-code"><button>Continue</button></main>',
    loading: '<main aria-busy="true"><h1>Projects</h1><p>Loading…</p></main>',
    empty: '',
    error: '<main><h1>Access denied</h1></main>',
  };
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    const authenticated =
      request.headers.cookie?.includes('session=fixture') && mode !== 'guest-cookie';
    if (request.url === '/session') {
      if (request.method === 'POST') {
        response.setHeader('Set-Cookie', 'session=fixture; HttpOnly; SameSite=Strict; Path=/');
        response.end('{}');
      } else {
        response.end(JSON.stringify({ signedIn: authenticated && mode !== 'spa-expired' }));
      }
    } else if (mode.startsWith('spa') && request.url === '/app') {
      response.end(`<main id="root"><h1>Projects</h1></main><script>
        const root = document.getElementById('root');
        const app = ${JSON.stringify(content.good)};
        setTimeout(async () => {
          const session = await fetch('/session').then(response => response.json());
          if (session.signedIn) { root.innerHTML = app; return; }
          root.innerHTML = ${JSON.stringify(form)};
          root.querySelector('form').onsubmit = async event => {
            event.preventDefault();
            await fetch('/session', {method: 'POST'});
            root.innerHTML = app;
          };
        }, 150);
      </script>`);
    } else if (request.url === '/login' && request.method === 'POST') {
      submissions++;
      response.setHeader('Set-Cookie', 'session=fixture; HttpOnly; SameSite=Strict; Path=/');
      response.writeHead(303, { Location: '/app' });
      response.end();
    } else if (request.url === '/app' && mode === 'public') {
      response.end('<main><h1>Public welcome page</h1></main>');
    } else if (request.url === '/app' && authenticated) {
      response.end(content[mode] ?? content.good);
    } else if (request.url === '/app') {
      response.writeHead(303, { Location: '/login' });
      response.end();
    } else {
      response.end(form);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    submissions: () => submissions,
    config: VerificationConfigSchema.parse({
      url: `${origin}/app`,
      webLogin: { loginUrl: `${origin}/${mode.startsWith('spa') ? 'app' : 'login'}` },
      credentials: { username: 'synthetic@example.test', password: 'synthetic-password' },
    }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

void test('automatic login uses the page and session rather than supplied confirmation text', async (t) => {
  const f = await loginFixture('good');
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
    await f.close();
  });
  const state = await privateBrowserLogin(browser, new URL(f.config.url!), f.config);
  assert.equal(f.submissions(), 1);
  assert.equal(state.cookies[0]?.name, 'session');
  assert.deepEqual(state.origins, []);
  const legacy = {
    ...f.config,
    webLogin: { ...f.config.webLogin!, successText: 'An obsolete heading' },
  };
  assert.ok((await privateBrowserLogin(browser, new URL(f.config.url!), legacy)).cookies.length);
});

void test(
  'automatic login fails closed on inconclusive pages',
  { concurrency: true },
  async (t) => {
    await Promise.all(
      ['public', 'guest-cookie', 'mfa', 'loading', 'empty', 'error', 'spa-expired'].map((mode) =>
        t.test(mode, async (t) => {
          const f = await loginFixture(mode);
          const browser = await launchBrowser();
          t.after(async () => {
            await browser.close();
            await f.close();
          });
          await assert.rejects(
            privateBrowserLogin(browser, new URL(f.config.url!), f.config),
            (error: Error) => {
              assert.match(error.message, /Could not verify sign-in automatically/);
              assert.ok(!error.message.includes('synthetic-password'));
              assert.ok(!error.message.includes('synthetic@example.test'));
              return true;
            },
          );
          if (mode === 'public') assert.equal(f.submissions(), 0);
        }),
      ),
    );
  },
);

void test('automatic login supports same-URL SPA sign-in and waits for session hydration', async (t) => {
  const f = await loginFixture('spa');
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
    await f.close();
  });
  const state = await privateBrowserLogin(browser, new URL(f.config.url!), f.config);
  assert.equal(state.cookies[0]?.name, 'session');
});
