const DynamicVoiceBot = require('./bot/DynamicVoiceBot');

// Create and start the bot
const bot = new DynamicVoiceBot();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await bot.stop();
    process.exit(0);
});

// Start the bot
bot.start().catch(console.error);
