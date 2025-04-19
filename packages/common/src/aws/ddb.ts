import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const TableName = process.env.TABLE_NAME!;
const client = new DynamoDBClient();
export const ddb = DynamoDBDocumentClient.from(client);
