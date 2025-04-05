import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TableName } from './ddb';

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

/**
 * Update existing metadata in DynamoDB by merging with new data.
 * @param tag The tag to use as the SK in DynamoDB
 * @param data The new object data to merge with existing data
 * @param workerId The worker ID to use as part of the PK
 * @returns The updated metadata object
 */
export const updateMetadata = async (tag: string, data: object, workerId: string = process.env.WORKER_ID!) => {
  // First read the existing metadata
  const existingData = (await readMetadata(tag, workerId)) || {};

  // Merge existing data with new data (new data overwrites existing fields with the same name)
  const mergedData = {
    ...existingData,
    ...data,
    // Preserve PK and SK which should not be overwritten
    PK: `metadata-${workerId}`,
    SK: tag,
  };

  // Write merged data back to DynamoDB
  await ddb.send(
    new PutCommand({
      TableName,
      Item: mergedData,
    })
  );

  return mergedData;
};
