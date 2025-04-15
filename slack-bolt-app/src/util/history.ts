import { PutCommand, QueryCommand, paginateQuery } from '@aws-sdk/lib-dynamodb';
import { ddb, TableName } from '../common/ddb';
import { Message } from '@aws-sdk/client-bedrock-runtime';

type MessageItem = {
  PK: string;
  SK: string;
  content: string;
  role: string;
  tokenCount: number;
  messageType: string;
  slackUserId: string;
};

export const saveConversationHistory = async (
  workerId: string,
  message: string,
  slackUserId: string,
  imageS3Keys: string[] = []
) => {
  const content = [];
  if (message) {
    content.push({ text: message });
  }
  imageS3Keys.forEach((key) => {
    content.push({
      image: {
        format: 'webp',
        source: {
          s3Key: key,
        },
      },
    });
  });
  await ddb.send(
    new PutCommand({
      TableName,
      Item: {
        PK: `message-${workerId}`,
        SK: `${String(Date.now()).padStart(15, '0')}`, // make sure it can be sorted in dictionary order
        content: JSON.stringify(content),
        role: 'user',
        tokenCount: 0,
        messageType: 'userMessage',
        slackUserId,
      } satisfies MessageItem,
    })
  );
};

export const getConversationHistory = async (workerId: string) => {
  const paginator = paginateQuery(
    {
      client: ddb,
    },
    {
      TableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `message-${workerId}`,
      },
    }
  );
  const items: MessageItem[] = [];
  for await (const page of paginator) {
    if (page.Items == null) {
      continue;
    }
    items.push(...(page.Items as any));
  }

  const history = items.map((item) => ({
    timestamp: item.SK,
    role: item.role,
    content: JSON.parse(item.content),
  })) as ({ timestamp: string } & Message)[];
  return history;
};

export const getTokenUsage = async (workerId: string) => {
  const res = await ddb.send(
    new QueryCommand({
      TableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `token-${workerId}`,
      },
    })
  );
  return res.Items ?? [];
};
