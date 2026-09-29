import type { z } from 'zod/v3';

/** Runtime tool metadata shares the exact argument schema enforced by its handler. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType<unknown>;
  /** Overrides the MCP read-only hint; omitted for repository tools, which derive it from their name. */
  readOnly?: boolean;
  run(input: unknown): unknown;
}

/** Infer handler arguments from the schema and reject unvalidated direct calls. */
export function defineTool<Input>(definition: {
  name: string;
  description: string;
  schema: z.ZodType<Input, z.ZodTypeDef, unknown>;
  readOnly?: boolean;
  run(input: Input): unknown;
}): ToolDefinition {
  return {
    ...definition,
    run: (input) => definition.run(definition.schema.parse(input)),
  };
}
