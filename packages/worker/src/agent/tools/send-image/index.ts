import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';
import { sendImageWithMessage } from '../../../common/slack';

const inputSchema = z.object({
  imagePath: z.string().describe('the local file system path to the image'),
  message: z.string().describe('message to send along with the image to user'),
});

const name = 'sendImageToUser';

export const sendImageTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: async (input: z.infer<typeof inputSchema>) => {
    await sendImageWithMessage(input.imagePath, input.message);
    return 'successfully sent an image with message.';
  },
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `Send an image with a message to the user. This tool will upload an image from a local file path and send it to the user through Slack with an accompanying message.`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
