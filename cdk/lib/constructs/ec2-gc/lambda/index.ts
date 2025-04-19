import { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand } from '@aws-sdk/client-ec2';

const ec2Client = new EC2Client();

const expirationInDays = parseInt(process.env.EXPIRATION_IN_DAYS ?? '2');

export const handler = async () => {
  const now = new Date();

  // Filter conditions to search for candidate instances
  const describeParams = {
    Filters: [
      { Name: 'tag-key', Values: ['RemoteSweWorkerId'] },
      { Name: 'instance-state-name', Values: ['stopped'] },
    ],
  };

  try {
    const describeInstancesCommand = new DescribeInstancesCommand(describeParams);
    const response = await ec2Client.send(describeInstancesCommand);

    const instancesForTermination = response.Reservations?.flatMap((reservation) => reservation.Instances || [])
      .filter((instance) => {
        // Extract instances that is started more than a day ago
        const launchTime = instance.LaunchTime;
        if (!launchTime) return false;

        const secondsSinceLaunch = (now.getTime() - launchTime.getTime()) / 1000;
        return secondsSinceLaunch >= expirationInDays * 24 * 3600;
      })
      .map((instance) => instance.InstanceId)
      .filter((id): id is string => id !== undefined);

    if (instancesForTermination && instancesForTermination.length > 0) {
      const terminateCommand = new TerminateInstancesCommand({
        InstanceIds: instancesForTermination,
      });
      await ec2Client.send(terminateCommand);
      console.log();
    } else {
      console.log('No instances to terminate');
    }
  } catch (error) {
    console.error('Error processing instances:', error);
    throw error;
  }
};
