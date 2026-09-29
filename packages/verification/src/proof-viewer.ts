import { readFile } from 'node:fs/promises';

import { z } from 'zod/v3';

import { ToolObservation, type ToolProvider } from '../../tools/src/mcp.js';
import { defineTool, type ToolDefinition } from '../../tools/src/tool-definition.js';

/** Serve one saved proof screenshot to the independent reviewer; it exposes no browser control. */
export class ProofViewer implements ToolProvider {
  private readonly tools: ToolDefinition[];
  /** Bind the absolute path of the outlined proof image for this review only. */
  constructor(file: string) {
    this.tools = [
      defineTool({
        name: 'view_proof_screenshot',
        description: 'Return the proof screenshot with the checked element outlined in red.',
        schema: z.object({}).strict(),
        readOnly: true,
        run: async () =>
          new ToolObservation('Proof screenshot. The checked element is outlined in red.', [
            { data: (await readFile(file)).toString('base64'), mimeType: 'image/png' },
          ]),
      }),
    ];
  }

  /** Describe the single read-only tool. */
  definitions(): ToolDefinition[] {
    return this.tools;
  }

  /** Run the screenshot tool; any other name is refused. */
  async call(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) throw new Error('Tool is not allowed.');
    return await tool.run(input);
  }
}
