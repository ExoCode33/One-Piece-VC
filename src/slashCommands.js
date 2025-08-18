// src/slashCommands.js - Complete Enhanced with XP Commands
const { SlashCommandBuilder, REST, Routes } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('check-voice-time')
        .setDescription('Check how much time and XP a user has earned in voice channels')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to check voice time and XP for')
                .setRequired(false)
        ),
    
    new SlashCommandBuilder()
        .setName('voice-leaderboard')
        .setDescription('Show the top voice users by XP in this server')
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('Number of users to show (max 20)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(20)
        ),
    
    new SlashCommandBuilder()
        .setName('xp-caps')
        .setDescription('Check your current XP caps and progress')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to check XP caps for')
                .setRequired(false)
        ),
    
    new SlashCommandBuilder()
        .setName('xp-activity')
        .setDescription('View recent XP earning activity')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to check XP activity for')
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('Number of recent activities to show (max 10)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10)
        ),
    
    new SlashCommandBuilder()
        .setName('bot-info')
        .setDescription('Show bot information and XP system statistics'),

    new SlashCommandBuilder()
        .setName('level-info')
        .setDescription('Check your current level and XP progress')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to check level for')
                .setRequired(false)
        )
];

async function registerSlashCommands(clientId, token) {
    const rest = new REST().setToken(token);

    try {
        console.log('🔄 Started refreshing application (/) commands with XP system.');

        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log('✅ Successfully reloaded application (/) commands with XP system.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
}

module.exports = { registerSlashCommands };
