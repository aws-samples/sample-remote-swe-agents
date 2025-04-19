import { EC2Client, StopInstancesCommand, TerminateInstancesCommand } from '@aws-sdk/client-ec2';
const client = new EC2Client();

export const terminateMyself = async () => {
  const instanceId = await getInstanceId();
  await client.send(
    new TerminateInstancesCommand({
      InstanceIds: [instanceId],
    })
  );
};

export const stopMyself = async () => {
  const instanceId = await getInstanceId();
  await client.send(
    new StopInstancesCommand({
      InstanceIds: [instanceId],
    })
  );
};

const getInstanceId = async () => {
  const token = await getImdsV2Token();
  const res = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
    headers: {
      'X-aws-ec2-metadata-token': token,
    },
  });
  return await res.text();
};

const getImdsV2Token = async () => {
  const res = await fetch('http://169.254.169.254/latest/api/token', {
    method: 'PUT',
    headers: {
      'X-aws-ec2-metadata-token-ttl-seconds': '900',
    },
  });
  return await res.text();
};
