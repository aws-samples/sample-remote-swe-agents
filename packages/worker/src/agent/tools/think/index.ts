import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';

const inputSchema = z.object({
  thought: z.string().describe('Your thoughts.'),
});

const name = 'think';

// https://www.anthropic.com/engineering/claude-think-tool
export const thinkTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: async (input: z.infer<typeof inputSchema>) => {
    return 'Nice thought.';
  },
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `Use the tool to think about something. It will not obtain new information or make any changes to the repository, but just log the thought. Use it when complex reasoning or brainstorming is needed. For example, if you explore the repo and discover the source of a bug, call this tool to brainstorm several unique ways of fixing the bug, and assess which change(s) are likely to be simplest and most effective. Alternatively, if you receive some test results, call this tool to brainstorm ways to fix the failing tests.
`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
