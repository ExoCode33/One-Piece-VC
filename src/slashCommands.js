// src/slashCommands.js
const { SlashCommandBuilder, REST, Routes } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('check-voice-time')
        .setDescription('Check how much time a user has spent in voice channels')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to check voice time for')
                .setRequired(false)
        ),
    
    new SlashCommandBuilder()
        .setName('voice-leaderboard')
        .setDescription('Show the top voice users in this server')
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('Number of users to show (max 20)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(20)
        ),
    
    new SlashCommandBuilder()
        .setName('bot-info')
        .setDescription('Show bot information and statistics')
];

async function registerSlashCommands(clientId, token) {
    const rest = new REST().setToken(token);

    try {
        console.log('🔄 Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
}

module.exports = { registerSlashCommands };
