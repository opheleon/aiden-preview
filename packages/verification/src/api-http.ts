import { randomUUID } from 'node:crypto';

import { z } from 'zod/v3';

import { parseApiUrl, redactor } from './policy.js';

/**
 * OpenAPI and JSON-Schema field names that describe how auth works rather than holding a secret
 * value. These win over `credentialField` below even when nested inside a matched container, so an
 * OAuth flow's `tokenUrl` or a token response's `token_type` are preserved as ordinary metadata.
 */
const authMetadataField =
  /^(?:tokenUrl|authorizationUrl|refreshUrl|openIdConnectUrl|token_?type|grant_?type|response_?type|scopes?|type|in|scheme|bearerFormat|flows?|description|title)$/i;
/** Field names whose own value is credential material, or that box up fields that are. */
const credentialField =
  /^(?:passwords?|passwd|pwd|secrets?|credentials?|tokens?|authorization|cookie|set-cookie|api[-_]?keys?|api[-_]?secrets?|client[-_]?secrets?|(?:access|refresh|id|session|auth|bearer|api)[-_]?tokens?)$/i;

/**
 * Whether one field, anywhere along its dotted path, sits inside a credential-named container,
 * unless its own name is auth metadata (which always wins, regardless of an enclosing container).
 */
function sensitiveField(key: string): boolean {
  const own = key.slice(key.lastIndexOf('.') + 1);
  if (authMetadataField.test(own)) return false;
  return key.split('.').some((segment) => credentialField.test(segment));
}

/** Split a compact JWT into its three base64url segments, or null when it is not JWT-shaped. */
function jwtParts(token: string): [string, string, string] | null {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0 && /^[\w-]+$/.test(p))
    ? (parts as [string, string, string])
    : null;
}

/** Flip the signature's final byte so it no longer verifies, without changing its shape. */
function corruptSignature(signature: string): string {
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.length === 0) return Buffer.from('invalid').toString('base64url');
  bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0xff) & 0xff;
  return bytes.toString('base64url');
}

/** Rewrite a JWT header so its algorithm is "none", for an unsigned-token negative test. */
function unsignedHeader(header: string): string {
  const decoded: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  const base = decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : {};
  return Buffer.from(JSON.stringify({ ...base, alg: 'none' })).toString('base64url');
}

/** Bounded HTTP input; credentials are referenced by opaque handles, never returned to the model. */
export const ApiRequestSchema = z
  .object({
    method: z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().min(1).max(2000),
    body: z.string().max(16000).nullable(),
    bearer: z.string().max(100).nullable(),
    reason: z.string().min(1).max(300),
  })
  .strict();
/** One response after credential redaction, suitable for recording and model inspection. */
export interface ApiReceipt {
  id: number;
  method: string;
  url: string;
  requestBody: string | null;
  bearer: string | null;
  status: number;
  body: unknown;
  secrets: Record<string, string>;
}

/** Worker-only credential vault and bounded fetch against one explicitly configured API base. */
export class ApiHttp {
  private secrets = new Map<string, string>();
  readonly receipts: ApiReceipt[] = [];
  readonly target: URL;
  /**
   * Validate the API address and bind its explicit write permission and cancellation signal.
   * `expiredToken` is an optional, worker-configured fixture: a token the project owner confirms
   * is genuinely expired and still properly signed, for testing expiry rejection specifically.
   */
  constructor(
    url: string,
    private readonly allowMutations: boolean,
    private readonly signal: AbortSignal,
    credentials?: { username: string; password: string },
    expiredToken?: string,
  ) {
    this.target = parseApiUrl(url);
    if (credentials) {
      this.secrets.set('username', credentials.username);
      this.secrets.set('password', credentials.password);
    }
    if (expiredToken) this.secrets.set('expiredToken', expiredToken);
  }
  /** Return credential handles for a fresh disposable identity; values remain in the worker. */
  identity(): { username: string; password: string } {
    return { username: this.keep(`aiden-${randomUUID()}`), password: this.keep(randomUUID()) };
  }
  /**
   * Derive negative-test variants of one already-issued JWT handle: a tampered signature (the same
   * claims, a signature that no longer verifies) and an unsigned rewrite (`alg: none`, no
   * signature). Neither is a genuinely expired token: without the API's signing key, Aiden cannot
   * forge a validly signed token with an edited expiry, so it does not offer that as a fixture.
   * Use the worker-configured `@secret:expiredToken` handle, when available, to test real expiry.
   */
  tamper(handle: string): { tamperedSignature: string; unsigned: string } {
    if (!handle.startsWith('@secret:')) throw new Error('Use an issued token handle.');
    const parts = jwtParts(this.resolve(handle));
    if (!parts)
      throw new Error('That credential is not a JWT, so there is no signature to tamper with.');
    const [header, payload, signature] = parts;
    return {
      tamperedSignature: this.keep(`${header}.${payload}.${corruptSignature(signature)}`),
      unsigned: this.keep(`${unsignedHeader(header)}.${payload}.`),
    };
  }
  /** Retain a secret and return a stable handle, reusing an existing handle for the same value. */
  private keep(value: string): string {
    for (const [key, saved] of this.secrets) if (saved === value) return `@secret:${key}`;
    const key = `s${this.secrets.size + 1}`;
    this.secrets.set(key, value);
    return `@secret:${key}`;
  }
  /** Resolve only a complete handle; literal body strings remain unchanged. */
  private resolve(value: string): string {
    if (!value.startsWith('@secret:')) return value;
    const secret = this.secrets.get(value.slice(8));
    if (!secret) throw new Error('Unknown credential handle.');
    return secret;
  }
  /**
   * Remove all known credential values and likely bearer/JWT representations from text. The
   * opaque-value match after "Bearer" requires substantial length so ordinary prose like "send a
   * bearer token" is left intact; only an actual opaque credential is long enough to match.
   */
  redact(text: string): string {
    return redactor([...this.secrets.values()])(text)
      .replace(
        /Bearer\s+(?=[\w\-.~+/]{8,})(?=[\w\-.~+/]*[.\-_/0-9])[\w\-.~+/]+=*/gi,
        'Bearer [redacted]',
      )
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted token]');
  }
  /** Substitute secret handles in JSON string values, rejecting ambiguous non-JSON bodies. */
  private requestBody(raw: string | null): string | undefined {
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw, (_key, item: unknown) =>
      typeof item === 'string' ? this.resolve(item) : item,
    );
    return JSON.stringify(value);
  }
  /** Capture response secrets before any response text leaves the worker. */
  private sanitize(value: unknown, handles: Record<string, string>, key = ''): unknown {
    const sensitive = sensitiveField(key);
    if (typeof value === 'string') {
      if (sensitive) {
        handles[key] = this.keep(value);
        return '[redacted]';
      }
      return this.redact(value);
    }
    if (Array.isArray(value)) return value.map((v) => this.sanitize(v, handles, key));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          this.sanitize(v, handles, sensitive ? `${key}.${k}` : k),
        ]),
      );
    return value;
  }
  /** Enforce the configured base and explicit write permission before network activity. */
  private requestUrl(request: z.infer<typeof ApiRequestSchema>): URL {
    const url = new URL(request.path, this.target);
    const prefix = this.target.pathname.replace(/\/$/, '');
    if (
      url.origin !== this.target.origin ||
      url.username ||
      url.password ||
      url.hash ||
      (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) ||
      /@secret:|%40secret/i.test(url.href) ||
      [...url.searchParams.keys()].some((key) =>
        /password|secret|token|authorization|cookie|api.?key/i.test(key),
      )
    )
      throw new Error('Request is outside the configured API base.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !this.allowMutations)
      throw new Error(
        'Test writes are disabled. Enable them only for a disposable API environment.',
      );
    return url;
  }
  /** Construct the small supported header set, resolving only vault credential handles. */
  private headers(request: z.infer<typeof ApiRequestSchema>): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (request.body !== null) headers['Content-Type'] = 'application/json';
    if (request.bearer) {
      if (request.bearer !== 'invalid-test-token' && !request.bearer.startsWith('@secret:'))
        throw new Error('Use a returned credential handle, null, or invalid-test-token.');
      headers.Authorization = `Bearer ${this.resolve(request.bearer)}`;
    }
    return headers;
  }
  /** Read at most 64 KiB and parse JSON when the endpoint supplies it. */
  private async responseBody(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (reader) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 65536) throw new Error('API response exceeds the 64 KiB evidence limit.');
        chunks.push(chunk.value);
      }
    } finally {
      await reader?.cancel();
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let responseBody: unknown = raw;
    try {
      responseBody = JSON.parse(raw);
    } catch {
      /* Text responses are recorded after redaction. */
    }
    return responseBody;
  }
  /** Fetch one bounded JSON/text response without following redirects or sending cookies. */
  async request(input: z.infer<typeof ApiRequestSchema>): Promise<ApiReceipt> {
    this.signal.throwIfAborted();
    const request = ApiRequestSchema.parse(input);
    const url = this.requestUrl(request);
    const headers = this.headers(request);
    const body = this.requestBody(request.body);
    if (body) this.sanitize(JSON.parse(body) as unknown, {});
    const response = await fetch(url, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(10000)]),
    });
    const responseBody = await this.responseBody(response);
    const secrets: Record<string, string> = {};
    // Discover all sensitive values first, then redact echoes elsewhere in the same response.
    this.sanitize(responseBody, secrets);
    const safeBody = this.sanitize(responseBody, secrets);
    const receipt: ApiReceipt = {
      id: this.receipts.length + 1,
      method: request.method,
      url: this.redact(url.href),
      requestBody: request.body === null ? null : this.redact(request.body),
      bearer: request.bearer,
      status: response.status,
      body: safeBody,
      secrets,
    };
    this.receipts.push(receipt);
    return receipt;
  }
}
