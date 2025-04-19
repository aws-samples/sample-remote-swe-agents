import { EC2Client, DescribeInstancesCommand, RunInstancesCommand, StartInstancesCommand } from '@aws-sdk/client-ec2';

const LaunchTemplateId = process.env.LAUNCH_TEMPLATE_ID!;
const SubnetIdList = process.env.SUBNET_ID_LIST!;
const ec2Client = new EC2Client({});

export async function findStoppedWorkerInstance(workerId: string) {
  return findWorkerInstanceWithStatus(workerId, ['running', 'stopped']);
}

export async function findRunningWorkerInstance(workerId: string) {
  return findWorkerInstanceWithStatus(workerId, ['running', 'pending']);
}
async function findWorkerInstanceWithStatus(workerId: string, statuses: string[]): Promise<string | null> {
  const describeCommand = new DescribeInstancesCommand({
    Filters: [
      {
        Name: 'tag:RemoteSweWorkerId',
        Values: [workerId],
      },
      {
        Name: 'instance-state-name',
        Values: statuses,
      },
    ],
  });

  try {
    const response = await ec2Client.send(describeCommand);

    if (response.Reservations && response.Reservations.length > 0) {
      const instances = response.Reservations[0].Instances;
      if (instances && instances.length > 0) {
        return instances[0].InstanceId || null;
      }
    }
    return null;
  } catch (error) {
    console.error(`Error finding worker instance with status ${statuses.join(',')}`, error);
    throw error;
  }
}

async function restartWorkerInstance(instanceId: string) {
  const startCommand = new StartInstancesCommand({
    InstanceIds: [instanceId],
  });

  try {
    await ec2Client.send(startCommand);
  } catch (error) {
    console.error('Error starting stopped instance:', error);
    throw error;
  }
}

async function createWorkerInstance(
  workerId: string,
  slackChannelId: string,
  slackThreadTs: string,
  launchTemplateId: string,
  subnetId: string
): Promise<string> {
  const runInstancesCommand = new RunInstancesCommand({
    LaunchTemplate: {
      LaunchTemplateId: launchTemplateId,
      Version: '$Latest',
    },
    MinCount: 1,
    MaxCount: 1,
    SubnetId: subnetId,
    TagSpecifications: [
      {
        ResourceType: 'instance',
        Tags: [
          {
            Key: 'RemoteSweWorkerId',
            Value: workerId,
          },
          {
            Key: 'SlackChannelId',
            Value: slackChannelId,
          },
          {
            Key: 'SlackThreadTs',
            Value: slackThreadTs,
          },
        ],
      },
    ],
  });

  try {
    const response = await ec2Client.send(runInstancesCommand);
    if (response.Instances && response.Instances.length > 0 && response.Instances[0].InstanceId) {
      return response.Instances[0].InstanceId;
    }
    throw new Error('Failed to create EC2 instance');
  } catch (error) {
    console.error('Error creating worker instance:', error);
    throw error;
  }
}

export async function getOrCreateWorkerInstance(
  workerId: string,
  slackChannelId: string,
  slackThreadTs: string
): Promise<{ instanceId: string; oldStatus: 'stopped' | 'terminated' | 'running' }> {
  // First, check if an instance with this workerId is already running
  const runningInstanceId = await findRunningWorkerInstance(workerId);
  if (runningInstanceId) {
    return { instanceId: runningInstanceId, oldStatus: 'running' };
  }

  // Then, check if a stopped instance exists and start it
  const stoppedInstanceId = await findStoppedWorkerInstance(workerId);
  if (stoppedInstanceId) {
    await restartWorkerInstance(stoppedInstanceId);
    return { instanceId: stoppedInstanceId, oldStatus: 'stopped' };
  }

  // TODO: choose subnet randomly
  const subnetId = SubnetIdList.split(',')[0];
  // If no instance exists, create a new one
  const instanceId = await createWorkerInstance(workerId, slackChannelId, slackThreadTs, LaunchTemplateId, subnetId);
  return { instanceId, oldStatus: 'terminated' };
}
