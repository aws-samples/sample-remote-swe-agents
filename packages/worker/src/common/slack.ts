import { App, AwsLambdaReceiver, LogLevel } from '@slack/bolt';
import { readFileSync, statSync } from 'fs';

const BotToken = process.env.SLACK_BOT_TOKEN!;
const channelID = process.env.SLACK_CHANNEL_ID!;
const threadTs = process.env.SLACK_THREAD_TS!;
const disableSlack = process.env.DISABLE_SLACK == 'true'; // for debugging

export const receiver = new AwsLambdaReceiver({
  // We don't need signingSecret because we use slack bolt only to send messages here.
  signingSecret: 'dummy',
});

let app: App | undefined = undefined;

const getApp = () => {
  if (app) return app;
  app = new App({
    token: BotToken,
    receiver,
    logLevel: LogLevel.DEBUG,
    developerMode: true,
    socketMode: false,
  });
  return app;
};

export const sendMessage = async (message: string, progress = false) => {
  if (disableSlack) {
    console.log(`[Slack] ${message}`);
    return;
  }
  await getApp().client.chat.postMessage({
    channel: channelID,
    thread_ts: threadTs,
    // limit to 40000 chars https://api.slack.com/methods/chat.postMessage#truncating
    text: message.slice(0, 40000),
    blocks: [
      ...(progress
        ? [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'progress',
                },
              ],
            },
          ]
        : []),
      {
        type: 'markdown',
        // limit to 12000 chars https://api.slack.com/reference/block-kit/blocks#markdown
        text: message.slice(0, 12000),
      } as any,
    ],
  });
};

export const sendImageWithMessage = async (imagePath: string, message: string, progress = false) => {
  if (disableSlack) {
    console.log(`[Slack] Image: ${imagePath}, Message: ${message}`);
    return;
  }

  const fileName = imagePath.split('/').pop() || 'image';
  const imageBuffer = readFileSync(imagePath);

  const result = await getApp().client.filesUploadV2({
    channel_id: channelID,
    thread_ts: threadTs,
    initial_comment: message,
    filename: fileName,
    file: imageBuffer,
  });

  if (!result.ok) {
    throw new Error(`Failed to upload image: ${result.error}`);
  }

  return result;
};
