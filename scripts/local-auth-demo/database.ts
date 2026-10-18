import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** Disposable local account configuration; never use real account credentials for the demo. */
export type DemoAccount = { email: string; password: string; apiKey: string };
/** Public note data rendered by the frontend and returned by the API. */
export type DemoNote = { id: number; text: string };

/** Hash high-entropy tokens before storing or comparing them. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
/** Store a salted password derivation rather than the password itself. */
function passwordHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
/** Check a password using the saved salt and a constant-time comparison. */
function matches(password: string, encoded: string): boolean {
  const [salt, hash] = encoded.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A real SQLite database with parameterized statements, password hashes, sessions, and notes. */
export class DemoDatabase {
  private db: DatabaseSync;
  /** Initialize local tables and seed exactly one disposable account if it does not exist. */
  constructor(
    file: string,
    private account: DemoAccount,
  ) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL);`);
    this.db
      .prepare('INSERT OR IGNORE INTO users(email,password_hash) VALUES (?,?)')
      .run(account.email, passwordHash(account.password));
  }
  /** Authenticate against SQLite and issue a fresh, hashed, one-hour session token. */
  login(email: string, password: string): string | null {
    const row = this.db.prepare('SELECT id,password_hash FROM users WHERE email=?').get(email);
    if (!row || !matches(password, String(row.password_hash))) return null;
    const token = randomBytes(32).toString('hex');
    this.db
      .prepare('INSERT INTO sessions VALUES (?,?,?)')
      .run(digest(token), row.id!, Date.now() + 3600000);
    return token;
  }
  /** Resolve only current sessions; token values never appear in the database. */
  user(token: string): { id: number; email: string } | null {
    const row = this.db
      .prepare(
        'SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?',
      )
      .get(digest(token), Date.now());
    return row ? { id: Number(row.id), email: String(row.email) } : null;
  }
  /** Invalidate a browser session on logout. */
  logout(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
  }
  /** Authenticate the demo API account with a header key and no browser session. */
  apiUser(key: string): number | null {
    if (!timingSafeEqual(Buffer.from(digest(key)), Buffer.from(digest(this.account.apiKey))))
      return null;
    const row = this.db.prepare('SELECT id FROM users WHERE email=?').get(this.account.email);
    return row ? Number(row.id) : null;
  }
  /** Read database-backed notes for exactly one user. */
  notes(userId: number): DemoNote[] {
    return this.db
      .prepare('SELECT id,text FROM notes WHERE user_id=? ORDER BY id DESC')
      .all(userId)
      .map((row) => ({ id: Number(row.id), text: String(row.text) }));
  }
  /** Persist a bounded note using parameters, never interpolated SQL. */
  addNote(userId: number, text: string): void {
    const clean = text.trim();
    if (!clean || clean.length > 500) throw new Error('Enter a note between 1 and 500 characters.');
    this.db.prepare('INSERT INTO notes(user_id,text) VALUES (?,?)').run(userId, clean);
  }
  /** Release database handles so the local example can restart cleanly. */
  close(): void {
    this.db.close();
  }
}
