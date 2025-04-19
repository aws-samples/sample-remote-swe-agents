# @remote-swe-agents/common

This package contains common code shared between the slack-bolt-app and worker packages in the remote-swe-agents monorepo.

## Installation

Since this is a workspace package, you don't need to install it separately. It's automatically available to other packages in the monorepo.

## Usage

Import the shared utilities in your code:

```typescript
// Import specific utilities
import { s3, BucketName, getBytesFromKey } from '@remote-swe-agents/common';
import { ddb, TableName } from '@remote-swe-agents/common';
import { createSlackApp, sendMessage, sendImageWithMessage } from '@remote-swe-agents/common';

// Or import everything
import * as common from '@remote-swe-agents/common';
```

## Available Utilities

### AWS S3

- `s3`: S3Client instance
- `BucketName`: Environment variable for the S3 bucket name
- `getBytesFromKey(key: string)`: Function to get bytes from an S3 object

### AWS DynamoDB

- `ddb`: DynamoDBDocumentClient instance
- `TableName`: Environment variable for the DynamoDB table name

### Slack

- `createSlackApp(botToken: string, signingSecret?: string)`: Function to create a Slack app instance
- `sendMessage(client, channelID, threadTs, message, progress?)`: Function to send a message to Slack
- `sendImageWithMessage(client, channelID, threadTs, imagePath, message, progress?)`: Function to send an image with a message to Slack
