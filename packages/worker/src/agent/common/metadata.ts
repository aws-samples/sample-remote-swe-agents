import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TableName } from '@remote-swe-agents/common';

/**
 * Write metadata to DynamoDB.
 * @param tag The tag to use as the SK in DynamoDB
 * @param data The object data to store
 * @param workerId The worker ID to use as part of the PK
 */
export const writeMetadata = async (tag: string, data: object, workerId: string = process.env.WORKER_ID!) => {
  await ddb.send(
    new PutCommand({
      TableName,
      Item: {
        PK: `metadata-${workerId}`,
        SK: tag,
        ...data,
      },
    })
  );
};

/**
 * Read metadata from DynamoDB.
 * @param tag The tag to use as the SK in DynamoDB
 * @param workerId The worker ID to use as part of the PK
 * @returns The metadata object or null if not found
 */
export const readMetadata = async (tag: string, workerId: string = process.env.WORKER_ID!) => {
  const result = await ddb.send(
    new GetCommand({
      TableName,
      Key: {
        PK: `metadata-${workerId}`,
        SK: tag,
      },
    })
  );

  return result.Item;
};
