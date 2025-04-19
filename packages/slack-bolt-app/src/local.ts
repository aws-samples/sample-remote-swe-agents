import app from './app';

(async () => {
  // Initialize and start your app
  await app.start(process.env.PORT || 3000);

  console.log('⚡️ Bolt app is running!');
})();
