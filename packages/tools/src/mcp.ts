import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { schemaFor } from '../../contracts/src/index.js';
import type { ToolDefinition } from './tool-definition.js';

/** One ephemeral loopback endpoint; its bearer token grants access only to this run’s broker. */
export interface LocalToolServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

/** Any allowlisted, schema-validated tool set; the repository broker and browser session both qualify. */
export interface ToolProvider {
  definitions(): ToolDefinition[];
  call(name: string, input: unknown): Promise<unknown>;
}

/** Screenshot bytes returned to multimodal providers as MCP image content. */
export interface ToolImage {
  data: string;
  mimeType: 'image/png' | 'image/jpeg';
}

/** A tool result that carries page screenshots next to its text observation. */
export class ToolObservation {
  /** Keep the text and base64 images together so both reach the model in one tool result. */
  constructor(
    readonly text: string,
    readonly images: readonly ToolImage[] = [],
  ) {}
}

/** Serialize ordinary results as JSON text; observations keep their screenshots as image blocks. */
function toolContent(
  result: unknown,
): ({ type: 'text'; text: string } | ({ type: 'image' } & ToolImage))[] {
  if (!(result instanceof ToolObservation)) return [{ type: 'text', text: JSON.stringify(result) }];
  return [
    { type: 'text', text: result.text },
    ...result.images.map((image) => ({ type: 'image' as const, ...image })),
  ];
}

/** Register only schema-validated broker operations; tools never accept arbitrary commands. */
function toolServer(broker: ToolProvider): Server {
  const server = new Server(
    { name: 'aiden-local-tools', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: broker.definitions().map((definition) => ({
      name: definition.name,
      description: definition.description,
      annotations: {
        readOnlyHint:
          definition.readOnly ??
          !['artifact_write', 'repo_sync', 'repo_fetch'].includes(definition.name),
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: ToolSchema.shape.inputSchema.parse(schemaFor(definition.schema)),
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return {
        content: toolContent(await broker.call(request.params.name, request.params.arguments)),
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool failed.' }],
      };
    }
  });
  return server;
}

/** Authenticate exact endpoint and bearer bytes; browser-origin requests are always denied. */
function authorized(request: IncomingMessage, response: ServerResponse, expected: Buffer): boolean {
  const actual = Buffer.from(request.headers.authorization ?? '');
  if (
    request.url !== '/mcp' ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    response.writeHead(401).end();
    return false;
  }
  if (request.headers.origin) {
    response.writeHead(403).end();
    return false;
  }
  return true;
}

/** Serve a stateless authenticated MCP request and release its transport when the response closes. */
async function handleRequest(
  broker: ToolProvider,
  request: IncomingMessage,
  response: ServerResponse,
  connections: Set<StreamableHTTPServerTransport>,
): Promise<void> {
  // Omitting a session generator selects the SDK stateless mode.
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  connections.add(transport);
  const server = toolServer(broker);
  response.on('close', () => {
    connections.delete(transport);
    // Peer disconnects can make shutdown reject; the response is already closed.
    void server.close().catch(() => {});
  });
  // SDK transports use explicit undefined for optional callbacks.
  await server.connect(transport as Transport);
  await transport.handleRequest(request, response);
}

/** Bind only loopback with a new token; callers must close the server when their run ends. */
export async function serveTools(broker: ToolProvider): Promise<LocalToolServer> {
  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const connections = new Set<StreamableHTTPServerTransport>();
  const http = createServer((request, response) => {
    if (!authorized(request, response, expected)) return;
    void handleRequest(broker, request, response, connections).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', () => resolve());
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Could not start local tools.');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    close: async () => {
      try {
        await Promise.all([...connections].map((transport) => transport.close()));
      } finally {
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
      }
    },
  };
}
