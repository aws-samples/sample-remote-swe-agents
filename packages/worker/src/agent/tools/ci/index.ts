import { setTimeout } from 'timers/promises';
import { executeCommand } from '../command-execution';
import { setKillTimer } from '../../../common/kill-timer';
import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';

const inputSchema = z.object({
  owner: z.string().describe('GitHub repository owner'),
  repo: z.string().describe('GitHub repository name'),
  pullRequestId: z
    .string()
    .describe('The sequential number of the pull request issued from GitHub, or the branch name.'),
});

const getLatestRunResult = async (input: { owner: string; repo: string; pullRequestId: string }) => {
  const { owner, repo, pullRequestId } = input;
  while (true) {
    try {
      const latestRun = await getLatestRunStatus(owner, repo, pullRequestId);
      if (['queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(latestRun.status)) {
        await setTimeout(5000);
        setKillTimer();
        continue;
      }
      if (latestRun.conclusion == 'success') {
        return `CI succeeded without errors!`;
      } else {
        const result: string = await execute(`gh run view ${latestRun.databaseId} -R ${owner}/${repo}`, true);
        const logs: string = await execute(
          `gh run view ${latestRun.databaseId} -R ${owner}/${repo} --log-failed`,
          true
        );
        logs
          .split('\n')
          .map((l) => l.split('\t').at(-1))
          .join('\n');
        return `CI failed with errors! <detail>${result}</detail>\n\nHere's the result of gh run view --log-failed:<log>${logs}</logs>`;
      }
    } catch (e) {
      console.log(e);
      return `getLatestRunResult failed: ${(e as Error).message}`;
    }
  }
};

const execute = async (command: string, plain = false): Promise<any> => {
  const res = await executeCommand(command);

  if (res.error != null) {
    throw new Error(JSON.stringify(res));
  }
  if (plain) {
    return res.stdout;
  }
  const parsed = JSON.parse(res.stdout);
  return parsed;
};

const getLatestRunStatus = async (owner: string, repo: string, pullRequestId: string) => {
  const pr = await execute(`gh pr view -R ${owner}/${repo} ${pullRequestId} --json commits`);
  const commitId = pr?.commits.at(-1).oid;
  if (!commitId) {
    throw new Error(`No commit found for the pull request ${pullRequestId} in repository ${owner}/${repo}`);
  }

  // Get latest workflow run for the PR if PR number is provided
  const runList = await execute(
    `gh run list -R ${owner}/${repo} -c ${commitId} --json conclusion,status,url,name,startedAt,databaseId`
  );
  // queued|in_progress|requested|waiting|pending|
  const latestRun = runList?.[0];
  if (!latestRun) {
    throw new Error('No workflow runs found');
  }
  return latestRun as { status: string; databaseId: string; conclusion: string };
};

const name = 'getGitHubActionsLatestResult';

export const ciTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: getLatestRunResult,
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `Wait for the GitHub Actions workflow to complete and get its status and logs for a specific PR.
IMPORTANT: You should always use this tool after pushing a commit to pull requests unless user requested otherwise.`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
