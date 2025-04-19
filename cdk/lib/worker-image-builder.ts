import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { WorkerImageBuilder } from './constructs/worker-image-builder';

export interface WorkerImageBuilderStackProps extends cdk.StackProps {
  workerAmiParameterName: string;
}

export class WorkerImageBuilderStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WorkerImageBuilderStackProps) {
    super(scope, id, props);

    // Create the Worker AMI Builder
    new WorkerImageBuilder(this, 'WorkerImageBuilder', {
      workerAmiParameterName: props.workerAmiParameterName,
    });
  }
}
