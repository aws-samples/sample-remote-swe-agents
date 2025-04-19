import { DefaultWorkingDirectory, executeCommand } from '../command-execution';
import { ToolDefinition, zodToJsonSchemaBody } from '../../common/lib';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { existsSync } from 'fs';
import { writeMetadata } from '../../common/metadata';

const inputSchema = z.object({
  owner: z.string().describe('GitHub repository owner'),
  repo: z.string().describe('GitHub repository name'),
});

const execute = async (command: string): Promise<any> => {
  const res = await executeCommand(command);

  if (res.error != null) {
    throw new Error(JSON.stringify(res));
  }
  return res.stdout;
};

const cloneRepository = async (input: { owner: string; repo: string }) => {
  const { owner, repo } = input;
  const dir = join(DefaultWorkingDirectory, repo);
  if (existsSync(dir)) {
    await execute(`rm -rf ${dir}`);
  }
  await execute(`gh repo clone ${owner}/${repo}`);
  // check write access https://stackoverflow.com/a/73898031/18550269
  const testBranchName = `test-${randomBytes(6).toString('hex')}`;
  let fork = false;
  const res = await executeCommand(
    `cd ${repo} && git branch ${testBranchName} && git push -u origin ${testBranchName}`
  );
  if (!res.error) {
    // no need to fork. delete the temporary branch
    await executeCommand(`cd ${repo} && git branch -d ${testBranchName} && git push -d origin ${testBranchName}`);
  } else {
    fork = true;
    // need to fork because we don't have write access to the repo
    await execute(`cd ${repo} && gh repo fork --remote`);
    const currentBranchName = await execute(`cd ${repo} && git rev-parse --abbrev-ref HEAD`);
    // pull the latest branch from upstream
    await execute(`cd ${repo} && git pull upstream ${currentBranchName}`);
  }

  // Save repository metadata to DynamoDB
  const workerId = process.env.WORKER_ID!;
  const repoDirectory = join(DefaultWorkingDirectory, repo);
  await writeMetadata(
    'repo',
    {
      repoOrg: owner,
      repoName: repo,
      isFork: fork,
      repoDirectory: repoDirectory,
    },
    workerId
  );

  return `repo is cloned in "${repoDirectory}"${fork ? ' (forked)' : ''}`;
};

const name = 'cloneGitHubRepository';

export const cloneRepositoryTool: ToolDefinition<z.infer<typeof inputSchema>> = {
  name,
  handler: cloneRepository,
  schema: inputSchema,
  toolSpec: async () => ({
    name,
    description: `Clone a GitHub repository into the local file system. Pass the repository's owner organization and name to clone.
If you do not have write access to the repository, a fork will be created and the repository will be cloned into the forked repository. If the directory with the same name exists, the existing directory is removed and overwritten by the new repository.
The local file system path to the cloned repository will be returned.
`,
    inputSchema: {
      json: zodToJsonSchemaBody(inputSchema),
    },
  }),
};
