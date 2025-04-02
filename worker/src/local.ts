import { createInterface } from 'readline';
import { onMessageReceived } from './agent';

const workerId = process.env.WORKER_ID ?? randomBytes(10).toString('hex');
process.env.WORKER_ID = workerId;
process.env.DISABLE_SLACK = 'true';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

import { saveConversationHistory } from './agent/common/messages';
import { randomBytes } from 'crypto';

async function processInput(input: string) {
  try {
    await saveConversationHistory(
      workerId,
      {
        role: 'user',
        content: [{ text: input }],
      },
      0,
      'userMessage'
    );
    await onMessageReceived(workerId);
  } catch (error) {
    console.error('An error occurred:', error);
  }
  rl.question('Enter your message: ', processInput);
}

console.log(`Local worker started. workerId: ${workerId}`);
rl.question('Enter your message: ', processInput);
