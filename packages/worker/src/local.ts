import { createInterface } from 'readline';
import { onMessageReceived } from './agent';
import './common/signal-handler';

process.env.DISABLE_SLACK = 'true';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const workerId = WorkerId;

import { saveConversationHistory } from './agent/common/messages';
import { WorkerId } from './common/constants';

async function processInput(input: string) {
  try {
    if (input) {
      await saveConversationHistory(
        workerId,
        {
          role: 'user',
          content: [{ text: input }],
        },
        0,
        'userMessage'
      );
    }
    await onMessageReceived(workerId);
  } catch (error) {
    console.error('An error occurred:', error);
  }
  rl.question('Enter your message: ', processInput);
}

console.log(`Local worker started. workerId: ${workerId}`);
rl.question('Enter your message: ', processInput);
