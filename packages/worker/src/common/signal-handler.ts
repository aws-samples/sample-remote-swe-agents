import { closeMcpServers } from '../agent/mcp';

const exit = async (signal: string) => {
  console.log(`${signal} received. Now shutting down ... please wait`);
  setTimeout(() => {
    process.exit(0);
  }, 3000);
  await closeMcpServers();
};

process.on('SIGHUP', () => {
  exit('SIGHUP');
});

process.on('SIGINT', () => {
  exit('SIGINT');
});

process.on('SIGTERM', () => {
  exit('SIGTERM');
});
