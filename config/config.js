require('dotenv').config();

module.exports = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    createChannelName: process.env.CREATE_CHANNEL_NAME || '🏴 Set Sail Together',
    categoryName: process.env.CATEGORY_NAME || '🌊 Grand Line Voice Channels',
    deleteDelay: parseInt(process.env.DELETE_DELAY) || 1000, // 1 second instead of 5
    debug: process.env.DEBUG === 'true'
};
