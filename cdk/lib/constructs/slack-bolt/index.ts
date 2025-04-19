import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { CfnStage, HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Code, DockerImageCode, DockerImageFunction, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { WorkerBus } from '../worker/bus';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IStringParameter } from 'aws-cdk-lib/aws-ssm';
import { join } from 'path';
import { readFileSync } from 'fs';

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
}

export class SlackBolt extends Construct {
  constructor(scope: Construct, id: string, props: SlackBoltProps) {
    super(scope, id);

    const { botTokenParameter, signingSecretParameter } = props;
    const asyncHandler = new DockerImageFunction(this, 'AsyncHandler', {
      code: DockerImageCode.fromImageAsset('..', {
        file: join('docker', 'slack-bolt-app.Dockerfile'),
        cmd: ['async-handler.handler'],
        exclude: readFileSync(join('..', 'docker', 'slack-bolt-app.Dockerfile.dockerignore')).toString().split('\n'),
      }),
      timeout: Duration.minutes(10),
      environment: {
        LAUNCH_TEMPLATE_ID: props.launchTemplateId,
        SUBNET_ID_LIST: props.subnetIdListForWorkers,
        BOT_TOKEN: botTokenParameter.stringValue,
        EVENT_HTTP_ENDPOINT: props.workerBus.httpEndpoint,
        TABLE_NAME: props.storageTable.tableName,
        BUCKET_NAME: props.storageBucket.bucketName,
      },
      architecture: Architecture.ARM_64,
    });
    props.storageTable.grantReadWriteData(asyncHandler);
    props.storageBucket.grantReadWrite(asyncHandler);
    props.workerBus.api.grantPublish(asyncHandler);

    const handler = new DockerImageFunction(this, 'Handler', {
      code: DockerImageCode.fromImageAsset('..', {
        file: join('docker', 'slack-bolt-app.Dockerfile'),
        exclude: readFileSync(join('..', 'docker', 'slack-bolt-app.Dockerfile.dockerignore')).toString().split('\n'),
      }),
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
