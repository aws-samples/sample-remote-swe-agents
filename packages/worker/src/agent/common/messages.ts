import { Message } from '@aws-sdk/client-bedrock-runtime';
import { PutCommand, UpdateCommand, paginateQuery, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getBytesFromKey, writeBytesToKey } from '@remote-swe-agents/common';
import sharp from 'sharp';
import { ddb, TableName } from '@remote-swe-agents/common';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { WorkerId } from '../../common/constants';

// Maximum input token count before applying middle-out strategy
export const MAX_INPUT_TOKEN = 80_000;

type MessageItem = {
  PK: string;
  SK: string;
  /**
   * messsage.content in json string
   */
  content: string;
  role: string;
  tokenCount: number;
  messageType: string;
  slackUserId?: string;
};

export const saveConversationHistoryAtomic = async (
  workerId: string,
  toolUseMessage: Message,
  toolResultMessage: Message,
  outputTokenCount: number
) => {
  const now = Date.now();
  const toolUseItem: MessageItem = {
    PK: `message-${workerId}`,
    SK: `${String(now).padStart(15, '0')}`,
    content: await preProcessMessageContent(toolUseMessage.content),
    role: toolUseMessage.role ?? 'unknown',
    tokenCount: outputTokenCount,
    messageType: 'toolUse',
  };

  const toolResultItem: MessageItem = {
    PK: `message-${workerId}`,
    SK: `${String(now + 1).padStart(15, '0')}`, // just add 1 to minimize the possibility of SK conflict
    content: await preProcessMessageContent(toolResultMessage.content),
    role: toolResultMessage.role ?? 'unknown',
    tokenCount: 0, // Will be updated later when we get token information
    messageType: 'toolResult',
  };

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [{ Put: { TableName, Item: toolUseItem } }, { Put: { TableName, Item: toolResultItem } }],
    })
  );
  return [toolUseItem, toolResultItem];
};

export const saveConversationHistory = async (
  workerId: string,
  message: Message,
  tokenCount: number,
  messageType: string
) => {
  const item = {
    PK: `message-${workerId}`,
    SK: `${String(Date.now()).padStart(15, '0')}`, // make sure it can be sorted in dictionary order
    content: await preProcessMessageContent(message.content),
    role: message.role ?? 'unknown',
    tokenCount,
    messageType,
  } satisfies MessageItem;

  await ddb.send(
    new PutCommand({
      TableName,
      Item: item,
    })
  );
  return item;
};

export const updateMessageTokenCount = async (workerId: string, messageSK: string, tokenCount: number) => {
  await ddb.send(
    new UpdateCommand({
      TableName,
      Key: {
        PK: `message-${workerId}`,
        SK: messageSK,
      },
      UpdateExpression: 'SET tokenCount = :tokenCount',
      ExpressionAttributeValues: {
        ':tokenCount': tokenCount,
      },
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

  return { items, slackUserId: searchForLastSlackUserId(items) };
};

const searchForLastSlackUserId = (items: MessageItem[]) => {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].slackUserId) {
      return items[i].slackUserId;
    }
  }
};

export const middleOutFiltering = async (items: MessageItem[]) => {
  // Calculate total token count to determine if we need middle-out filtering
  let totalTokenCount = items.reduce((sum: number, item) => sum + item.tokenCount, 0);
  const headRatio = 0.6;
  const tailRatio = 1 - headRatio;

  // Apply middle-out strategy if token count exceeds the maximum
  if (totalTokenCount < MAX_INPUT_TOKEN) {
    return { items, totalTokenCount, messages: await itemsToMessages(items) };
  }
  console.log(`Applying middle-out strategy. Total tokens: ${totalTokenCount}, max tokens: ${MAX_INPUT_TOKEN}`);

  totalTokenCount = 0;
  // Get front messages until we reach half of max tokens
  const frontMessages: MessageItem[] = [];
  let frontTokenCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    frontTokenCount += item.tokenCount;

    // always include the first message.
    if (i == 0 || frontTokenCount <= MAX_INPUT_TOKEN * headRatio) {
      frontMessages.push(item);
      totalTokenCount += item.tokenCount;
    } else {
      break;
    }
  }

  // Get end messages until we reach half of max tokens
  const endMessages: MessageItem[] = [];
  let endTokenCount = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    endTokenCount += item.tokenCount;

    if (endTokenCount <= MAX_INPUT_TOKEN * tailRatio) {
      endMessages.unshift(item); // Add to start of array to maintain order
      totalTokenCount += item.tokenCount;
    } else {
      break;
    }
  }

  // If the last message in front is a toolUse, remove it
  // (because we don't want to split toolUse-toolResult pairs)
  if (frontMessages.length > 0 && frontMessages[frontMessages.length - 1].messageType === 'toolUse') {
    const item = frontMessages.pop()!;
    totalTokenCount -= item.tokenCount;
  }

  // If the first message in end is a toolResult, remove it
  // (because we don't want to split toolUse-toolResult pairs)
  if (endMessages.length > 0 && endMessages[0].messageType === 'toolResult') {
    const item = endMessages.shift()!;
    totalTokenCount -= item.tokenCount;
  }

  items = [...frontMessages, ...endMessages];
  // Combine front and end messages
  return { items, totalTokenCount, messages: await itemsToMessages(items) };
};

export const noOpFiltering = async (items: MessageItem[]) => {
  let totalTokenCount = items.reduce((sum: number, item) => sum + item.tokenCount, 0);
  return { items, totalTokenCount, messages: await itemsToMessages(items) };
};

const itemsToMessages = async (items: MessageItem[]) => {
  return (await Promise.all(
    items.map(async (item) => ({
      role: item.role,
      content: await postProcessMessageContent(item.content),
    }))
  )) as Message[];
};

/**
 * process message content before saving it to DB
 */
const preProcessMessageContent = async (content: Message['content']) => {
  const workerId = WorkerId;
  content = structuredClone(content) ?? [];

  for (const c of content) {
    // store image in toolResult content to S3
    if (c.toolResult?.content) {
      for (const cc of c.toolResult.content) {
        if (cc.image?.source?.bytes != null) {
          const bytes = cc.image.source.bytes;
          const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
          const s3Key = `${workerId}/${hash}.${cc.image.format}`;
          await writeBytesToKey(s3Key, bytes);
          const newContent = cc.image.source as any;
          delete newContent['bytes'];
          newContent.s3Key = s3Key;
        }
      }
    }
  }

  return JSON.stringify(content);
};

const imageCache: Record<string, { data: Uint8Array; localPath: string; format: string }> = {};
let imageSeqNo = 0;

const ensureImagesDirectory = () => {
  const imagesDir = path.join(tmpdir(), `.remote-swe-images`);
  if (!existsSync(imagesDir)) {
    mkdirSync(imagesDir, { recursive: true });
  }
  return imagesDir;
};

const saveImageToLocalFs = async (imageBuffer: Uint8Array): Promise<string> => {
  const imagesDir = ensureImagesDirectory();

  // Convert webp to jpeg for better compatibility with CLI tools
  const jpegBuffer = await sharp(imageBuffer).jpeg({ quality: 85 }).toBuffer();
  const extension = 'jpeg';

  // Create path with sequence number
  const fileName = `image${imageSeqNo}.${extension}`;
  const filePath = path.join(imagesDir, fileName);

  // Write image to file
  writeFileSync(filePath, jpegBuffer);

  // Increment sequence number for next image
  imageSeqNo++;

  // Return the path in the format specified in the issue
  return filePath;
};

/**
 * process message content after getting it from DB
 */
const postProcessMessageContent = async (content: string) => {
  const contentArray = JSON.parse(content);
  const flattenedArray = [];

  for (const c of contentArray) {
    if (typeof c.image?.source?.s3Key == 'string') {
      const s3Key = c.image.source.s3Key as string;
      let imageBuffer: Uint8Array;
      let localPath: string;
      let imageFormat: string;

      if (s3Key in imageCache) {
        imageBuffer = imageCache[s3Key].data;
        localPath = imageCache[s3Key].localPath;
        imageFormat = imageCache[s3Key].format;
      } else if (['png', 'jpeg', 'gif', 'webp'].some((ext) => s3Key.endsWith(ext))) {
        imageBuffer = await getBytesFromKey(s3Key);
        localPath = s3Key;
        imageFormat = s3Key.split('.').pop()!;
      } else {
        const file = await getBytesFromKey(s3Key);
        imageBuffer = await sharp(file).webp({ lossless: false, quality: 80 }).toBuffer();
        localPath = await saveImageToLocalFs(imageBuffer);
        imageFormat = 'webp';
      }
      imageCache[s3Key] = { data: imageBuffer, localPath, format: imageFormat };

      flattenedArray.push({
        image: {
          format: imageFormat,
          source: {
            bytes: imageBuffer,
          },
        },
      });
      flattenedArray.push({
        text: `the image is stored locally on ${localPath}`,
      });
    } else if (c.toolResult?.content != null) {
      c.toolResult.content = await postProcessMessageContent(JSON.stringify(c.toolResult.content));
      flattenedArray.push(c);
    } else {
      flattenedArray.push(c);
    }
  }

  return flattenedArray;
};
