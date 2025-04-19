import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

const cache = {
  updatedAt: 0,
  token: '',
};

export const authorizeGitHubCli = async () => {
  if (cache.updatedAt > Date.now() - 50 * 60 * 1000) {
    return cache.token;
  }
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    cache.token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  } else if (
    //
    process.env.GITHUB_APP_PRIVATE_KEY_PATH &&
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_INSTALLATION_ID
  ) {
    console.log(`refreshing token...`);
    const { stdout } = await execAsync(
      `gh-token generate --key ${process.env.GITHUB_APP_PRIVATE_KEY_PATH} --app-id ${process.env.GITHUB_APP_ID} --installation-id ${process.env.GITHUB_APP_INSTALLATION_ID}`
    );
    const token = JSON.parse(stdout).token;
    if (!token) {
      throw new Error('Failed to get GitHub token');
    }
    cache.token = token;
  } else {
    throw new Error('No GitHub credentials provided');
  }

  await execAsync(`gh auth setup-git`, {
    env: {
      ...process.env,
      GITHUB_TOKEN: cache.token,
    },
  });
  cache.updatedAt = Date.now();
  return cache.token;
};
