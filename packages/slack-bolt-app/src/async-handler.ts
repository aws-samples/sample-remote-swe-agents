import { Handler } from 'aws-lambda';
import { getOrCreateWorkerInstance } from './util/worker-manager';
import { App, AwsLambdaReceiver, LogLevel } from '@slack/bolt';

const BotToken = process.env.BOT_TOKEN!;

export const receiver = new AwsLambdaReceiver({
  signingSecret: 'dummy',
});

const app = new App({
  token: BotToken,
  receiver,
  logLevel: LogLevel.DEBUG,
  developerMode: true,
  socketMode: false,
});

type Event = { type: 'ensureInstance'; workerId: string; slackChannelId: string; slackThreadTs: string };

// slack api timeouts in just a 3 seconds so we run actual process asynchronously
// we might not need this because idempotency using dynamodb lock almost resolved the problem.
export const handler: Handler<Event> = async (event, context) => {
  if (event.type == 'ensureInstance') {
    const res = await getOrCreateWorkerInstance(event.workerId, event.slackChannelId, event.slackThreadTs);

    if (res.oldStatus == 'stopped') {
      await app.client.chat.postMessage({
        channel: event.slackChannelId,
        thread_ts: event.slackThreadTs,
        text: `Waking up from sleep mode...`,
      });
    } else if (res.oldStatus == 'terminated') {
      await app.client.chat.postMessage({
        channel: event.slackChannelId,
        thread_ts: event.slackThreadTs,
        text: `Preparing for a new instance...`,
      });
    }
  }
};
