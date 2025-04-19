import { Construct } from 'constructs';
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'path';
import { Stack } from 'aws-cdk-lib';

export interface WorkerImageBuilderProps {
  /**
   * The name of the SSM parameter to store the AMI ID
   */
  workerAmiParameterName: string;
}

export class WorkerImageBuilder extends Construct {
  /**
   * The SSM parameter that stores the latest AMI ID
   */
  public readonly amiIdParameter: ssm.StringParameter;

  /**
   * The Image Builder pipeline that creates the AMI
   */
  public readonly pipeline: imagebuilder.CfnImagePipeline;

  constructor(scope: Construct, id: string, props: WorkerImageBuilderProps) {
    super(scope, id);

    // Create an IAM role for the Image Builder instance
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'),
      ],
    });

    // Create an infrastructure configuration
    const infraConfig = new imagebuilder.CfnInfrastructureConfiguration(this, 'InfraConfig', {
      name: 'WorkerInfraConfig',
      instanceTypes: ['t3.medium'],
      instanceProfileName: new iam.CfnInstanceProfile(this, 'InstanceProfile', {
        roles: [instanceRole.roleName],
      }).ref,
      // subnetId: vpc.privateSubnets[0].subnetId,
      terminateInstanceOnFailure: true,
      snsTopicArn: undefined, // Optional: Add SNS topic for notifications
    });

    // Create a component for installing Docker, Git, Node.js, etc.
    // TODO: Test uv
    // # Verify uv installation
    // if ! command -v uv &> /dev/null; then
    //   echo "uv is not installed properly"
    //   exit 1
    // fi
    const componentData = `
name: InstallWorkerDependencies
description: Install dependencies for Worker instances
schemaVersion: 1.0

phases:
  - name: build
    steps:
      - name: InstallDependencies
        action: ExecuteBash
        inputs:
          commands:
            - |
              # Install Node.js 20, Docker, Git, and other dependencies
              # this sometimes fails. so retry. https://github.com/amazonlinux/amazon-linux-2023/issues/397#issuecomment-1760177301
              while true; do
                dnf install -y nodejs20 docker git python3.12 python3.12-pip 'dnf-command(config-manager)' && break
              done
              ln -s -f /usr/bin/node-20 /usr/bin/node
              ln -s -f /usr/bin/npm-20 /usr/bin/npm
              ln -s -f /usr/bin/npx-20 /usr/bin/npx
              ln -s -f /usr/bin/python3.12 /usr/bin/python
              ln -s -f /usr/bin/pip3.12 /usr/bin/pip
              systemctl enable docker
              usermod -a -G docker ec2-user

              # Install Fluent Bit
              curl https://raw.githubusercontent.com/fluent/fluent-bit/master/install.sh | sh

              # Install GitHub CLI
              dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
              while true; do
                dnf install -y gh --repo gh-cli && break
              done
              
              # Install Google Chrome
              # https://github.com/amazonlinux/amazon-linux-2023/discussions/417#discussioncomment-8246163
              while true; do
                dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm && break
              done

              # install uv
              sudo -u ec2-user bash -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'

              # install playwright
              npx playwright install chromium
  - name: test
    steps:
      - name: VerifyInstallations
        action: ExecuteBash
        inputs:
          commands:
            - |
              # Verify Node.js installation
              if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
                echo "Node.js or npm is not installed properly"
                exit 1
              fi
              node_version=$(node -v)
              echo "Node.js version: $node_version"

              # Verify Docker installation
              if ! command -v docker &> /dev/null; then
                echo "Docker is not installed properly"
                exit 1
              fi
              if ! systemctl is-active --quiet docker; then
                echo "Docker service is not running"
                exit 1
              fi
              docker_version=$(docker --version)
              echo "Docker version: $docker_version"

              # Verify Git installation
              if ! command -v git &> /dev/null; then
                echo "Git is not installed properly"
                exit 1
              fi
              git_version=$(git --version)
              echo "Git version: $git_version"

              # Verify GitHub CLI installation
              if ! command -v gh &> /dev/null; then
                echo "GitHub CLI is not installed properly"
                exit 1
              fi
              gh_version=$(gh --version)
              echo "GitHub CLI version: $gh_version"

              # Verify Google Chrome installation
              if ! command -v google-chrome &> /dev/null; then
                echo "Google Chrome is not installed properly"
                exit 1
              fi
              chrome_version=$(google-chrome --version)
              echo "Google Chrome version: $chrome_version"

              # Verify Fluent Bit installation
              if ! command -v /opt/fluent-bit/bin/fluent-bit &> /dev/null; then
                echo "Fluent Bit is not installed properly"
                exit 1
              fi

              # Verify Python installation
              if ! command -v python &> /dev/null; then
                echo "Python is not installed properly"
                exit 1
              fi

              echo "All package verifications completed successfully"
`;

    // Create a component document
    const component = new imagebuilder.CfnComponent(this, 'WorkerComponent', {
      name: 'RemoteSWEAgentesWorker',
      platform: 'Linux',
      version: '0.0.7',
      data: componentData,
    });

    // Create a recipe using Amazon Linux 2023
    const recipe = new imagebuilder.CfnImageRecipe(this, 'Recipe', {
      name: 'RemoteSWEAgentesWorker',
      version: '0.0.7',
      parentImage: `arn:aws:imagebuilder:${Stack.of(this).region}:aws:image/amazon-linux-2023-x86/x.x.x`, // Latest AL2023
      components: [
        {
          componentArn: component.attrArn,
        },
      ],
    });

    // Create a distribution configuration
    const distributionConfig = new imagebuilder.CfnDistributionConfiguration(this, 'DistributionConfig', {
      name: 'RemoteSWEAgentesWorker',
      distributions: [
        {
          region: Stack.of(this).region,
          amiDistributionConfiguration: {
            name: 'Worker-AMI-{{imagebuilder:buildDate}}',
            description: 'AMI for Worker instances with pre-installed dependencies',
          },
        },
      ],
    });

    // Create an image pipeline
    const pipelineName = 'RemoteSWEAgentesWorker';
    const pipeline = new imagebuilder.CfnImagePipeline(this, 'WorkerPipeline', {
      name: pipelineName,
      infrastructureConfigurationArn: infraConfig.attrArn,
      distributionConfigurationArn: distributionConfig.attrArn,
      imageRecipeArn: recipe.attrArn,
      // Schedule the pipeline to run weekly
      schedule: {
        pipelineExecutionStartCondition: 'EXPRESSION_MATCH_AND_DEPENDENCY_UPDATES_AVAILABLE',
        scheduleExpression: 'cron(0 0 ? * SUN *)',
      },
      status: 'ENABLED',
    });
    this.pipeline = pipeline;

    // Create SSM parameter to store the AMI ID
    const amiIdParameter = new ssm.StringParameter(this, 'AmiIdParameter', {
      parameterName: props.workerAmiParameterName,
      description: 'Latest Worker AMI ID created by Image Builder',
      stringValue: 'initial-value', // Will be updated by the Lambda function
    });
    this.amiIdParameter = amiIdParameter;

    // Create an EventBridge rule to trigger the Lambda when a new AMI is created
    const imageCreatedRule = new events.Rule(this, 'Rule', {
      eventPattern: {
        source: ['aws.imagebuilder'],
        detailType: ['EC2 Image Builder Image State Change'],
        detail: {
          state: { status: ['AVAILABLE'] },
        },
      },
    });

    const storeAmiId = tasks.CallAwsService.jsonata(this, 'StoreAmiId', {
      service: 'ssm',
      action: 'putParameter',
      iamResources: [amiIdParameter.parameterArn],
      parameters: {
        Name: amiIdParameter.parameterName,
        Value: '{% $states.input.amiId %}',
        Type: 'String',
        Overwrite: true,
      },
    });

    const choice = sfn.Choice.jsonata(this, 'Choice')
      .when(sfn.Condition.jsonata('{% $states.input.isTarget %}'), storeAmiId)
      .otherwise(sfn.Succeed.jsonata(this, 'NotTarget'));

    const getImage = tasks.CallAwsService.jsonata(this, 'GetImage', {
      service: 'imagebuilder',
      action: 'getImage',
      iamResources: ['*'],
      parameters: {
        ImageBuildVersionArn: '{% $states.input.resources[0] %}',
      },
      outputs: {
        amiId: '{% $states.result.Image.OutputResources.Amis[0].Image %}',
        // TODO: パイプラインARNで完全一致させたいが、値部分でAWSリソースの参照ができなかったため、ラフだがcontainsで判定している。
        isTarget: `{% $contains($states.result.Image.SourcePipelineArn, $lowercase("image-pipeline/${pipelineName}")) %}`,
        sourcePipelineArn: '{% $states.result.Image.SourcePipelineArn %}',
      },
    });

    const workflow = getImage.next(choice);

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(workflow),
    });

    imageCreatedRule.addTarget(new targets.SfnStateMachine(stateMachine));
  }
}
