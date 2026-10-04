import { rename } from 'node:fs/promises';
import path from 'node:path';

import type { Browser, BrowserContext, Page } from 'playwright';
import { z } from 'zod/v3';

import type { PageCheck, VerificationStep } from '../../contracts/src/index.js';
import type { ToolProvider } from '../../tools/src/mcp.js';
import { defineTool, type ToolDefinition } from '../../tools/src/tool-definition.js';
import { ApiHttp, ApiRequestSchema } from './api-http.js';

const assertion = z
  .object({
    field: z.string().min(1).max(200),
    operator: z.enum(['equals', 'exists', 'absent']),
    value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
  })
  .strict();
const checkSchema = z
  .object({
    requestId: z.number().int().positive(),
    assertions: z.array(assertion).min(1).max(20),
    reason: z.string().min(1).max(300),
  })
  .strict();
const tamperSchema = z.object({ token: z.string().min(1).max(100) }).strict();

/** Resolve a dot-separated JSON field without inherited properties or executable expressions. */
function field(body: unknown, name: string): unknown {
  let value = body;
  for (const part of name.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** Recorded API ledger: HTTP runs in the worker; the page displays sanitized evidence only. */
export class ApiSession implements ToolProvider {
  readonly steps: VerificationStep[] = [];
  readonly checks: PageCheck[] = [];
  stepLimitReached = false;
  private readonly started = Date.now();
  private readonly tools: ToolDefinition[];
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** Bind an inert recording page, HTTP boundary, attempt limits, and an optional live-status callback. */
  private constructor(
    private readonly context: BrowserContext,
    readonly page: Page,
    readonly http: ApiHttp,
    private readonly dir: string,
    private readonly limit: number,
    private readonly progress?: (message: string) => void,
  ) {
    this.tools = [
      defineTool({
        name: 'api_identity',
        description:
          'Create disposable test username/password handles. Use the returned handles as JSON body values.',
        schema: z.object({}).strict(),
        readOnly: true,
        run: () => this.step('Created a disposable identity', '', () => this.http.identity()),
      }),
      defineTool({
        name: 'api_request',
        description:
          'Send a request to the configured API only. body is JSON or null. bearer is a returned @secret handle, invalid-test-token, or null. Responses hide credentials; secrets maps fields to reusable handles. Redirects are refused.',
        schema: ApiRequestSchema,
        readOnly: false,
        run: (input) =>
          this.step(`${input.method} ${input.path}`, input.reason, () => this.http.request(input)),
      }),
      defineTool({
        name: 'api_check',
        description:
          'Assert a recorded response. field is status or body.<dot path>. All assertions must hold. Cite the returned check id as proofCheck. This checks the response, not database internals.',
        schema: checkSchema,
        readOnly: true,
        run: (input) => this.check(input),
      }),
      defineTool({
        name: 'api_tamper_token',
        description:
          'Derive negative-test variants of an already-issued JWT handle (such as secrets.access_token): a tamperedSignature handle whose signature no longer verifies, and an unsigned handle rewritten to alg "none". Neither is a genuinely expired token; use @secret:expiredToken for that when available.',
        schema: tamperSchema,
        readOnly: true,
        run: ({ token }) =>
          this.step('Derived tampered token variants', '', () => this.http.tamper(token)),
      }),
    ];
  }
  /** Open a video-recorded, network-disabled evidence page with no application credentials. */
  static async open(
    browser: Browser,
    http: ApiHttp,
    dir: string,
    criterion: string,
    limit: number,
    progress?: (message: string) => void,
  ): Promise<ApiSession> {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: { dir, size: { width: 1280, height: 800 } },
    });
    try {
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(
        '<!doctype html><meta charset="utf-8"><title>API verification</title><style>body{font:18px system-ui;background:#f5f5f3;color:#202020;padding:28px}h1{font-size:26px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:18px;border:1px solid #ddd}p{max-width:1100px}</style><h1>API verification</h1><p id="criterion"></p><p>Recorded HTTP evidence. Credentials are hidden.</p><pre id="ledger"></pre>',
      );
      await page.locator('#criterion').evaluate((node, text) => {
        node.textContent = text;
      }, http.redact(criterion));
      return new ApiSession(context, page, http, dir, limit, progress);
    } catch (error) {
      await context.close();
      throw error;
    }
  }
  /** Expose the bounded API toolset through the same run-scoped MCP boundary as browser tools. */
  definitions(): ToolDefinition[] {
    return this.tools;
  }
  /** Dispatch validated arguments, hiding transport details that might contain credentials. */
  async call(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) throw new Error('Tool is not allowed.');
    const next = this.queue.then(() => tool.run(input));
    this.queue = next.catch(() => {});
    return await next;
  }
  /** Record both successful operations and errors, never allowing the model to edit the ledger. */
  private async step(action: string, reasoning: string, run: () => unknown): Promise<unknown> {
    if (this.steps.length >= this.limit) {
      this.stepLimitReached = true;
      throw new Error('API step limit reached.');
    }
    let value: unknown;
    let error: unknown;
    try {
      value = await run();
    } catch (caught) {
      error = caught;
      value = {
        error:
          'Request or check could not complete. Confirm API address, test credentials, permissions, and response size.',
      };
    }
    const result = this.http.redact(JSON.stringify(value));
    const index = this.steps.length + 1;
    const screenshot = `step-${index}.png`;
    const step = {
      index,
      action: this.http.redact(action),
      reasoning: this.http.redact(reasoning),
      result,
      url: this.http.target.href,
      atMs: Date.now() - this.started,
      screenshot,
    };
    this.steps.push(step);
    this.progress?.(step.action);
    await this.page.locator('#ledger').evaluate((node, text) => {
      node.textContent = text;
    }, `${step.action}\n${step.reasoning}\n\n${result}`);
    await this.page.screenshot({ path: path.join(this.dir, screenshot) });
    // Keep each recorded result visible for several video frames without adding test-server work.
    await this.page.waitForTimeout(150);
    if (error)
      throw new Error(
        'API operation could not complete; the recorded step explains the limitation.',
      );
    return JSON.parse(result) as unknown;
  }
  /** Evaluate assertions in trusted code; failed comparisons produce failed evidence, never an exception. */
  private async check(input: z.infer<typeof checkSchema>): Promise<unknown> {
    const result = (await this.step('Checked API response', input.reason, () => {
      const receipt = this.http.receipts.find((r) => r.id === input.requestId);
      if (!receipt) throw new Error('Unknown response.');
      const assertions = input.assertions.map((a) => {
        const actual = field(receipt, a.field);
        const passed =
          a.operator === 'exists'
            ? actual !== undefined && actual !== null
            : a.operator === 'absent'
              ? actual === undefined
              : actual === a.value;
        return { ...a, actual: actual ?? null, passed };
      });
      return {
        id: this.checks.length + 1,
        requestId: receipt.id,
        passed: assertions.every((a) => a.passed),
        assertions,
      };
    })) as { id: number; passed: boolean };
    const step = this.steps.at(-1)!;
    const proof: PageCheck = {
      id: result.id,
      step: step.index,
      role: 'status',
      name: 'API assertions',
      state: 'has_text',
      text: null,
      passed: result.passed,
      actual: step.result,
      atMs: step.atMs,
      screenshot: step.screenshot!,
    };
    this.checks.push(proof);
    return result;
  }
  /** Finalize the recording after its sanitized last frame, keeping the existing Watch media contract. */
  async close(): Promise<string> {
    if (this.closed) return 'video.webm';
    this.closed = true;
    const video = this.page.video();
    await this.context.close();
    if (video) await rename(await video.path(), path.join(this.dir, 'video.webm'));
    return 'video.webm';
  }
}
