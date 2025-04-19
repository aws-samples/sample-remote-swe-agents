import { Amplify } from 'aws-amplify';
import { events } from 'aws-amplify/data';
import { sendMessage } from './common/slack';
import { onMessageReceived, resume } from './agent';
import { setKillTimer } from './common/kill-timer';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

Object.assign(global, { WebSocket: require('ws') });

const workerId = process.env.WORKER_ID!;
const eventHttpEndpoint = process.env.EVENT_HTTP_ENDPOINT!;
const awsRegion = process.env.AWS_REGION!;

Amplify.configure(
  {
    API: {
      Events: {
        endpoint: `${eventHttpEndpoint}/event`,
        region: awsRegion,
        defaultAuthMode: 'iam',
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => {
          const provider = fromNodeProviderChain();
          const credentials = await provider();
          return {
            credentials,
          };
        },
        clearCredentialsAndIdentityId: async () => {},
      },
    },
  }
);

const main = async () => {
  const broadcast = await events.connect('/event-bus/broadcast');
  broadcast.subscribe({
    next: (data) => {
      console.log('received broadcast', data);
    },
    error: (err) => console.error('error', err),
  });

  const unicast = await events.connect(`/event-bus/${workerId}`);
  unicast.subscribe({
    next: async (data) => {
      try {
        setKillTimer();
        const type = data.event?.type;
        if (type == 'onMessageReceived') {
          await onMessageReceived(workerId);
        }
      } catch (e) {
        await sendMessage(`An error occurred: ${e}`);
      }
    },
    error: (err) => console.error('error', err),
  });

  setKillTimer();

  try {
    await sendMessage('the instance has successfully launched!');
    await resume(workerId);
  } catch (e) {
    await sendMessage(`An error occurred: ${e}`);
  }
};

main();
