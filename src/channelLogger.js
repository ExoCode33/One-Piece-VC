// src/channelLogger.js
const { EmbedBuilder } = require('discord.js');

class ChannelLogger {
    constructor(client) {
        this.client = client;
        this.logChannelName = process.env.VOICE_LOG_CHANNEL || 'voice-activity-log';
        this.enableLogging = process.env.ENABLE_VOICE_LOGGING === 'true';
        
        if (this.enableLogging) {
            console.log(`🔍 Channel Logger initialized - Target channel: ${this.logChannelName}`);
        } else {
            console.log(`⚠️ Channel logging disabled. Set ENABLE_VOICE_LOGGING=true to enable.`);
        }
    }

    async logVoiceEvent(guildId, userId, username, channelId, channelName, action, additionalInfo = {}) {
        if (!this.enableLogging) return;
        
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            // Find the log channel
            const logChannel = guild.channels.cache.find(channel => 
                channel.name === this.logChannelName && channel.type === 0 // Text channel
            );

            if (!logChannel) {
                // Only warn once per guild to avoid spam
                if (!this.missingChannelWarned) {
                    console.warn(`⚠️ Voice log channel "${this.logChannelName}" not found in ${guild.name}`);
                    console.warn(`💡 Create channel with: !createvoicelog`);
                    this.missingChannelWarned = true;
                }
                return;
            }

            // Create embed based on action
            const embed = this.createLogEmbed(userId, username, channelId, channelName, action, additionalInfo);
            
            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error sending log message:', error);
        }
    }

    createLogEmbed(userId, username, channelId, channelName, action, additionalInfo) {
        const embed = new EmbedBuilder()
            .setTimestamp()
            .setFooter({ text: 'Voice Activity Logger' });

        const userMention = `<@${userId}>`;
        const channelMention = channelId ? `<#${channelId}>` : 'Unknown Channel';

        switch (action) {
            case 'JOIN':
                embed
                    .setColor('#00FF00') // Green
                    .setTitle('🎤 User Joined Voice')
                    .setDescription(`${userMention} joined ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true }
                    );
                break;

            case 'LEAVE':
                embed
                    .setColor('#FF0000') // Red
                    .setTitle('👋 User Left Voice')
                    .setDescription(`${userMention} left ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true }
                    );

                // Add session duration if available
                if (additionalInfo.sessionDuration) {
                    const duration = additionalInfo.sessionDuration;
                    const hours = Math.floor(duration / 3600);
                    const minutes = Math.floor((duration % 3600) / 60);
                    const seconds = duration % 60;
                    
                    let durationText = '';
                    if (hours > 0) durationText += `${hours}h `;
                    if (minutes > 0) durationText += `${minutes}m `;
                    if (seconds > 0 || durationText === '') durationText += `${seconds}s`;
                    
                    embed.addFields({ name: '⏱️ Session Duration', value: durationText, inline: true });
                }
                break;

            case 'MOVE':
                embed
                    .setColor('#FFA500') // Orange
                    .setTitle('🔄 User Moved Voice Channels')
                    .setDescription(`${userMention} moved to ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 From', value: `${additionalInfo.oldChannelName || 'Unknown'}`, inline: true },
                        { name: '🏠 To', value: `${channelName || 'Unknown'}`, inline: true }
                    );
                break;

            default:
                embed
                    .setColor('#FFFF00') // Yellow
                    .setTitle('❓ Voice Activity')
                    .setDescription(`${userMention} - ${action} in ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true },
                        { name: '🔧 Action', value: action, inline: true }
                    );
        }

        return embed;
    }

    // Method to create log channel
    async createLogChannel(guild) {
        try {
            // Check if channel already exists
            const existingChannel = guild.channels.cache.find(channel => 
                channel.name === this.logChannelName && channel.type === 0
            );

            if (existingChannel) {
                return existingChannel;
            }

            const newChannel = await guild.channels.create({
                name: this.logChannelName,
                type: 0, // Text channel
                topic: 'Automatic voice activity logging - Join/Leave/Move events',
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: ['SendMessages'], // Only allow viewing, not sending
                        allow: ['ViewChannel']
                    }
                ]
            });

            console.log(`✅ Created voice log channel: ${newChannel.name} in ${guild.name}`);
            return newChannel;
        } catch (error) {
            console.error('❌ Error creating voice log channel:', error);
            return null;
        }
    }
}

module.exports = ChannelLogger;
