import type { DemoNote } from './database.js';

/** Escape stored or supplied strings before rendering the HTML frontend. */
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
/** Shared responsive frontend; forms submit to the Node backend and never simulate success. */
function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Aiden test app</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f5f3ee;color:#292830;font:16px system-ui,sans-serif;line-height:1.5}main{max-width:1040px;margin:8vh auto;padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:start}.eyebrow{font-size:12px;letter-spacing:.12em;font-weight:700;color:#686276;text-transform:uppercase}h1{font-size:48px;line-height:1.08;letter-spacing:-2px;margin:24px 0}p{color:#686276}.card{background:white;border:1px solid #ddd9e4;border-radius:20px;padding:32px;box-shadow:0 12px 40px #28213508}h2{font-size:24px;margin:0 0 24px}label{display:grid;gap:8px;margin:20px 0;font-weight:600;font-size:14px}input,textarea{width:100%;border:1px solid #cfcbd7;border-radius:8px;padding:12px;font:inherit;background:#fff}button{border:0;border-radius:9px;padding:13px 20px;background:#6151b9;color:white;font:600 14px system-ui;cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #ae9ff2;outline-offset:3px}.secondary{background:#eeebf7;color:#4c427a}ul{padding:0;list-style:none}li{padding:16px 0;border-bottom:1px solid #e9e6ee;overflow-wrap:anywhere}.tag{display:inline-block;padding:6px 10px;background:#e9e4f7;border-radius:20px;color:#544883;font-size:12px}.error{color:#a32b36;background:#fff0f1;padding:12px;border-radius:8px}.meta{font-size:13px}a{color:#6151b9}@media(max-width:720px){main{grid-template-columns:1fr;gap:24px;margin:24px auto}h1{font-size:36px}.card{padding:24px}}
  </style></head><body><main><section><span class="eyebrow">Aiden · local test app</span><h1>A real login.<br>A real database.</h1><p>A small notes app for testing private sign-in and API-key access from end to end.</p><span class="tag">Local SQLite · disposable data</span><p class="meta">The browser uses a session cookie. The API uses a key. Both read and write the same database.</p></section><section class="card">${content}</section></main></body></html>`;
}
/** Login form for the seeded local account; password and key are never echoed into the page. */
export function loginPage(failed = false): string {
  return page(
    'Sign in',
    `<h2>Sign in to Notes</h2>${failed ? '<p role="alert" class="error">Email or password is incorrect.</p>' : ''}<form method="post" action="/login"><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form><p class="meta">Use the disposable account in the demo README.</p>`,
  );
}
/** Protected database-backed page with a real write form and a server-side logout. */
export function notesPage(email: string, notes: DemoNote[]): string {
  return page(
    'Your notes',
    `<h2>Your notes</h2><p class="meta">Signed in as ${escape(email)}</p><form method="post" action="/notes"><label>New note<textarea name="text" rows="3" maxlength="500" required placeholder="Write something to test…"></textarea></label><button type="submit">Save note</button></form><ul aria-label="Saved notes">${notes.map((note) => `<li>${escape(note.text)}</li>`).join('')}</ul>${!notes.length ? '<p>No notes yet. Save your first note above.</p>' : ''}<form method="post" action="/logout"><button class="secondary" type="submit">Sign out</button></form>`,
  );
}
