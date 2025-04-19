import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TableName } from '@remote-swe-agents/common';

// We cannot use email to refer to a user because user:read scope is forbidden.
// Instead, we use userId directly.
const getAdminUserIds = (): string[] => {
  const adminUserIdList = process.env.ADMIN_USER_ID_LIST;
  if (!adminUserIdList) return [];
  return adminUserIdList.split(',');
};

export const isAuthorized = async (userId: string, channelId: string) => {
  // If ADMIN_USER_ID_LIST is not set, authorize all users
  if (!process.env.ADMIN_USER_ID_LIST) {
    return true;
  }

  const adminUserIds = getAdminUserIds();
  if (adminUserIds.includes(userId)) return true;

  const res = await ddb.send(
    new QueryCommand({
      TableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `approved-${channelId}`,
      },
    })
  );
  const approved = (res.Items ?? []).map((item) => item.SK as string);

  return approved.includes(userId);
};

export const ApproveUsers = async (userIdList: string[], channelId: string) => {
  await ddb.send(
    new BatchWriteCommand({
      RequestItems: {
        [TableName]: userIdList.map((userId) => ({
          PutRequest: {
            Item: {
              PK: `approved-${channelId}`,
              SK: userId,
            },
          },
        })),
      },
    })
  );
};
