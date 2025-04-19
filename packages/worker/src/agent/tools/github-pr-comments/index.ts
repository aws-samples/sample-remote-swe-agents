import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';
import { executeCommand } from '../command-execution';

const getPRCommentsSchema = z.object({
  owner: z.string().describe('GitHub repository owner'),
  repo: z.string().describe('GitHub repository name'),
  pullRequestId: z.string().describe('The sequential number of the pull request issued from GitHub'),
});

const replyPRCommentSchema = z.object({
  owner: z.string().describe('GitHub repository owner'),
  repo: z.string().describe('GitHub repository name'),
  pullRequestId: z.string().describe('The sequential number of the pull request issued from GitHub'),
  commentId: z.string().describe('ID of the comment to reply to'),
  body: z.string().describe('The text of the reply comment'),
});

const getPRCommentsHandler = async (input: z.infer<typeof getPRCommentsSchema>) => {
  const { owner, repo, pullRequestId } = input;

  try {
    // Use GitHub CLI to get PR comments
    const result = await executeCommand(
      `gh api repos/${owner}/${repo}/pulls/${pullRequestId}/comments --jq '.[] | {id: .id, user: .user.login, body: .body, path: .path, position: .position, created_at: .created_at, html_url: .html_url}'`
    );

    if (result.error) {
      return `Failed to get PR comments: ${result.error}`;
    }

    if (!result.stdout.trim()) {
      return 'No review comments found for this PR.';
    }

    return result.stdout;
  } catch (error: any) {
    return `Error retrieving PR comments: ${error.message}`;
  }
};

const replyPRCommentHandler = async (input: z.infer<typeof replyPRCommentSchema>) => {
  const { owner, repo, pullRequestId, commentId, body } = input;

  try {
    // Use GitHub CLI to reply to a comment
    const result = await executeCommand(
      `gh api --method POST repos/${owner}/${repo}/pulls/${pullRequestId}/comments/${commentId}/replies -f body="${body}"`
    );

    if (result.error) {
      return `Failed to reply to comment: ${result.error}`;
    }

    return `Successfully replied to comment ${commentId}`;
  } catch (error: any) {
    return `Error replying to comment: ${error.message}`;
  }
};

// Tool definitions
export const getPRCommentsTool: ToolDefinition<z.infer<typeof getPRCommentsSchema>> = {
  name: 'getPRComments',
  handler: getPRCommentsHandler,
  schema: getPRCommentsSchema,
  toolSpec: async () => ({
    name: 'getPRComments',
    description: 'Get review comments for a specific GitHub PR.',
    inputSchema: {
      json: zodToJsonSchemaBody(getPRCommentsSchema),
    },
  }),
};

export const replyPRCommentTool: ToolDefinition<z.infer<typeof replyPRCommentSchema>> = {
  name: 'replyPRComment',
  handler: replyPRCommentHandler,
  schema: replyPRCommentSchema,
  toolSpec: async () => ({
    name: 'replyPRComment',
    description: 'Reply to a specific comment in a GitHub pull request.',
    inputSchema: {
      json: zodToJsonSchemaBody(replyPRCommentSchema),
    },
  }),
};

// Test script code - only runs when file is executed directly
if (require.main === module && false) {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  const printUsage = () => {
    console.log('Usage:');
    console.log('  npx tsx worker/src/agent/tools/github-pr-comments/index.ts get <owner> <repo> <pullRequestId>');
    console.log(
      '  npx tsx worker/src/agent/tools/github-pr-comments/index.ts reply <owner> <repo> <pullRequestId> <commentId> <body>'
    );
    console.log('\nExamples:');
    console.log('  npx tsx worker/src/agent/tools/github-pr-comments/index.ts get aws-samples remote-swe-agents 32');
    console.log(
      '  npx tsx worker/src/agent/tools/github-pr-comments/index.ts reply aws-samples remote-swe-agents 32 1234567890 "Thanks for the feedback!"'
    );
  };

  const runTest = async () => {
    try {
      switch (command) {
        case 'get':
          if (args.length < 4) {
            console.error('Error: Not enough arguments for get command');
            printUsage();
            process.exit(1);
          }

          const [owner, repo, pullRequestId] = args.slice(1);
          console.log(`Getting comments for PR #${pullRequestId} in ${owner}/${repo}...`);

          const getResult = await getPRCommentsHandler({ owner, repo, pullRequestId });
          console.log('Result:');
          console.log(getResult);
          break;

        case 'reply':
          if (args.length < 6) {
            console.error('Error: Not enough arguments for reply command');
            printUsage();
            process.exit(1);
          }

          const [replyOwner, replyRepo, replyPullRequestId, commentId, ...bodyParts] = args.slice(1);
          const body = bodyParts.join(' ');

          console.log(`Replying to comment ${commentId} in PR #${replyPullRequestId} of ${replyOwner}/${replyRepo}...`);
          console.log(`Message: "${body}"`);

          const replyResult = await replyPRCommentHandler({
            owner: replyOwner,
            repo: replyRepo,
            pullRequestId: replyPullRequestId,
            commentId,
            body,
          });

          console.log('Result:');
          console.log(replyResult);
          break;

        default:
          console.error('Error: Unknown command. Use "get" or "reply"');
          printUsage();
          process.exit(1);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  };

  // Run the test
  runTest();
}
