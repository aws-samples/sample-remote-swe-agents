import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';
import { sendMessage } from '../../../common/slack';

const inputSchema = z.object({
  message: z.string().describe('The message you want to send to the user.'),
});

const name = 'sendMessageToUser';

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
    description: `Send any message to the user. This is especially valuable if the message contains any information the user want to know, such as how you are solving the problem now. Without this tool, a user cannot know your progress because message is only sent when you finished using tools and end your turn.`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
