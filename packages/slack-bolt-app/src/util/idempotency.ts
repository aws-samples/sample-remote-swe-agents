import { IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import * as idempotency from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';

// TODO: possibly use this: https://docs.powertools.aws.dev/lambda/typescript/latest/utilities/idempotency/#installation
const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: process.env.TABLE_NAME!,
  keyAttr: 'PK',
  sortKeyAttr: 'SK',
  expiryAttr: 'TTL',
});
const config = new IdempotencyConfig({ expiresAfterSeconds: 600 });

/**
 * make `func` called exactly once.
 * @param func a function that takes idempotency key as the first argument.
 * @returns
 */
export const makeIdempotent = <T>(func: (key: string) => Promise<T>): ((key: string) => Promise<T>) => {
  return idempotency.makeIdempotent(func, {
    persistenceStore,
    config,
  });
};
