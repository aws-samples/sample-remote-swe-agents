# Worker

This is the agent implementation that works in its own EC2 environment.

## Run locally

You can run the agent locally using the below command. Note that you must provide `BUCKET_NAME` and `TABLE_NAME` using the actual ARN. 

```sh
cd packages/common
npm run watch
```

```sh
export BUCKET_NAME=remoteswestack-sandbox-storageimagebucket99ba9550-lqsrca5cnznn
export TABLE_NAME=RemoteSweStack-Sandbox-StorageHistory251A3AE8-9XH4C0BO957Q
export DISABLE_SLACK=true
export EVENT_HTTP_ENDPOINT="https://API_ID.appsync-api.ap-northeast-1.amazonaws.com"
export GITHUB_PERSONAL_ACCESS_TOKEN='dummy'
export BEDROCK_AWS_ACCOUNTS='475977027832'
npx tsx src/local.ts
```
