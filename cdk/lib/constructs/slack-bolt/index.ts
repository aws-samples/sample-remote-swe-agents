import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { CfnStage, HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { WorkerBus } from '../worker/bus';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IStringParameter, StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface SlackBoltProps {
  signingSecretParameter: IStringParameter;
  botTokenParameter: IStringParameter;
  launchTemplateId: string;
  subnetIdListForWorkers: string;
  workerBus: WorkerBus;
  storageTable: ITableV2;
  storageBucket: IBucket;
  adminUserIdList?: string;
  workerLogGroupName: string;
  workerAmiId: IStringParameter;
}

export class SlackBolt extends Construct {
  constructor(scope: Construct, id: string, props: SlackBoltProps) {
    super(scope, id);

    const { botTokenParameter, signingSecretParameter } = props;
    const asyncHandler = new NodejsFunction(this, 'AsyncHandler', {
      entry: '../slack-bolt-app/src/async-handler.ts',
      runtime: Runtime.NODEJS_20_X,
      depsLockFilePath: '../slack-bolt-app/package-lock.json',
      timeout: Duration.minutes(10),
      environment: {
        LAUNCH_TEMPLATE_ID: props.launchTemplateId,
        SUBNET_ID_LIST: props.subnetIdListForWorkers,
        BOT_TOKEN: botTokenParameter.stringValue,
        EVENT_HTTP_ENDPOINT: props.workerBus.httpEndpoint,
        TABLE_NAME: props.storageTable.tableName,
        BUCKET_NAME: props.storageBucket.bucketName,
        WORKER_AMI_PARAMETER_NAME: props.workerAmiId.parameterName,
      },
      architecture: Architecture.ARM_64,
      bundling: {
        commandHooks: {
          beforeBundling: (i, o) => [`cd ${i} && npm install`],
          afterBundling: (i, o) => [],
          beforeInstall: (i, o) => [],
        },
        bundleAwsSDK: true,
      },
    });
    props.storageTable.grantReadWriteData(asyncHandler);
    props.storageBucket.grantReadWrite(asyncHandler);
    props.workerBus.api.grantPublish(asyncHandler);
    props.workerAmiId.grantRead(asyncHandler);

    const handler = new NodejsFunction(this, 'Handler', {
      entry: '../slack-bolt-app/src/lambda.ts',
      runtime: Runtime.NODEJS_20_X,
      depsLockFilePath: '../slack-bolt-app/package-lock.json',
      timeout: Duration.seconds(29),
      environment: {
        SIGNING_SECRET: signingSecretParameter.stringValue,
        BOT_TOKEN: botTokenParameter.stringValue,
        ASYNC_LAMBDA_NAME: asyncHandler.functionName,
        EVENT_HTTP_ENDPOINT: props.workerBus.httpEndpoint,
        TABLE_NAME: props.storageTable.tableName,
        BUCKET_NAME: props.storageBucket.bucketName,
        LOG_GROUP_NAME: props.workerLogGroupName,
        ...(props.adminUserIdList ? { ADMIN_USER_ID_LIST: props.adminUserIdList } : {}),
      },
      architecture: Architecture.ARM_64,
      bundling: {
        commandHooks: {
          beforeBundling: (i, o) => [`cd ${i} && npm install`],
          afterBundling: (i, o) => [],
          beforeInstall: (i, o) => [],
        },
        bundleAwsSDK: true,
      },
    });
    asyncHandler.grantInvoke(handler);
    props.storageTable.grantReadWriteData(handler);
    props.storageBucket.grantReadWrite(handler);
    props.workerBus.api.grantPublish(handler);

    const api = new HttpApi(this, 'Api', {
      description: 'slack bolt app',
      defaultIntegration: new HttpLambdaIntegration('Integration', handler),
    });
    // https://github.com/aws/aws-cdk/issues/11100#issuecomment-782176520
    const accessLogGroup = new LogGroup(this, 'AccessLog', {
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const defaultStage = api.defaultStage?.node.defaultChild as CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: accessLogGroup.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        ip: '$context.identity.sourceIp',
        caller: '$context.identity.caller',
        user: '$context.identity.user',
        requestTime: '$context.requestTime',
        httpMethod: '$context.httpMethod',
        resourcePath: '$context.resourcePath',
        status: '$context.status',
        protocol: '$context.protocol',
        responseLength: '$context.responseLength',
      }),
    };

    asyncHandler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          // required to run instances from launch template
          'ec2:RunInstances',
          'ec2:DescribeInstances',
          'iam:PassRole',
          'ec2:CreateTags',
          'ec2:StartInstances',
        ],
        resources: ['*'],
      })
    );

    new CfnOutput(this, 'EndpointUrl', { value: api.apiEndpoint });
  }
}
