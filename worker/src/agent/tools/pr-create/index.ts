import { executeCommand } from '../command-execution';
import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';
import { readMetadata, updateMetadata } from '../../common/metadata';

const inputSchema = z.object({
  title: z.string().describe('PR title'),
  description: z.string().describe('PR description'),
  issueNo: z.string().describe('Issue number to be closed by this PR'),
  directory: z.string().describe('Local directory containing the git repository'),
});

const execute = async (command: string, plain = false): Promise<any> => {
  const res = await executeCommand(command);

  if (res.error != null) {
    throw new Error(JSON.stringify(res));
  }
  if (plain) {
    return res.stdout;
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return parsed;
  } catch (e) {
    return res.stdout;
  }
};

const createPullRequest = async (input: { title: string; description: string; issueNo: string; directory: string }) => {
  const { title, description, issueNo, directory } = input;
  const workerId = process.env.WORKER_ID!;

  // Check if PR has already been created in this session
  const prMetadata = await readMetadata('pull-request', workerId);
  if (prMetadata && prMetadata.prId) {
    return `Error: A pull request (${prMetadata.prId}) has already been created in this session. Please use the existing PR.`;
  }

  // Get repository metadata to verify directory matches
  const repoMetadata = await readMetadata('repo', workerId);
  if (!repoMetadata || !repoMetadata.repoDirectory) {
    return 'Error: No repository has been cloned in this session. Please clone a repository first using cloneGitHubRepository.';
  }

  // Ensure directory matches with the cloned repository
  if (repoMetadata.repoDirectory !== directory) {
    return `Error: The specified directory (${directory}) does not match the cloned repository directory (${repoMetadata.repoDirectory}).`;
  }

  try {
    // Ensure description includes "close #issueNo"
    let finalDescription = description;
    const closePattern = new RegExp(
      `close #${issueNo}|closes #${issueNo}|closed #${issueNo}|fix #${issueNo}|fixes #${issueNo}|fixed #${issueNo}|resolve #${issueNo}|resolves #${issueNo}|resolved #${issueNo}`,
      'i'
    );

    if (!closePattern.test(description)) {
      finalDescription = `${description}\n\nCloses #${issueNo}`;
    }

    // Create PR using heredoc for proper markdown formatting
    const result = await execute(
      `cd ${directory} && gh pr create --title "${title}" --body "$(cat <<EOF
${finalDescription}
EOF
)"`,
      true
    );

    // Extract PR number from GitHub CLI output
    const prUrlMatch = result.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
    if (!prUrlMatch || !prUrlMatch[1]) {
      throw new Error('Failed to extract PR number from GitHub response');
    }

    const prId = prUrlMatch[1];

    // Store PR ID in DynamoDB
    await updateMetadata('pull-request', { prId }, workerId);

    return `Successfully created PR #${prId}: ${result}`;
  } catch (e) {
    return `Error creating PR: ${(e as Error).message}`;
  }
};

const name = 'createPullRequest';

export const createPullRequestTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: createPullRequest,
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `Create a GitHub pull request from the current branch and store its ID for later use.
The PR description will always include "Closes #issueNo" to ensure the referenced issue is closed when the PR is merged.
Only one PR can be created per session.`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
