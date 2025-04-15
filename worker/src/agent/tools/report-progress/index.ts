import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';
import { sendMessage } from '../../../common/slack';

const inputSchema = z.object({
  thought: z.string().describe('Your thoughts on the message.'),
  message: z
    .string()
    .describe('The message you want to send to the user. Set empty string to avoid sending unnecessary message.'),
});

const name = 'sendMessageToUserIfNecessary';

export const reportProgressTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: async (input: z.infer<typeof inputSchema>) => {
    if (!input.message) return 'No message was sent.';
    await sendMessage(input.message, true);
    return 'Successfully sent a message.';
  },
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `
Send any message to the user. This is especially valuable if the message contains any information the user want to know, such as how you are solving the problem now. Without this tool, a user cannot know your progress because message is only sent when you finished using tools and end your turn.

Please output your thoughts on how to compose your message to the user before actually writing the message. Remember, if you do not have anything to send or just too immature to report progress, you can just pass an empty string to the \`message\` property to skip sending a message.
    `,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
