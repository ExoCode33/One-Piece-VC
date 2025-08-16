// src/channelLogger.js
const { EmbedBuilder } = require('discord.js');

class ChannelLogger {
    constructor(client) {
        this.client = client;
        this.logChannelId = process.env.VOICE_LOG_CHANNEL_ID;
        this.logChannelName = process.env.VOICE_LOG_CHANNEL || 'voice-activity-log';
        this.enableLogging = process.env.ENABLE_VOICE_LOGGING === 'true';
        
        if (this.enableLogging) {
            if (this.logChannelId) {
                console.log(`🔍 Channel Logger initialized - Target channel ID: ${this.logChannelId}`);
            } else {
                console.log(`🔍 Channel Logger initialized - Target channel name: ${this.logChannelName}`);
            }
        } else {
            console.log(`⚠️ Channel logging disabled. Set ENABLE_VOICE_LOGGING=true to enable.`);
        }
    }

    async logVoiceEvent(guildId, userId, username, channelId, channelName, action, additionalInfo = {}) {
        if (!this.enableLogging) {
            console.log(`🔇 Voice logging disabled, skipping ${action} event for ${username}`);
            return;
        }
        
        console.log(`🔍 Attempting to log ${action} event for ${username} in ${channelName}`);
        
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) {
                console.warn(`❌ Guild ${guildId} not found`);
                return;
            }

            let logChannel;
            
            // Try to find by ID first (preferred method)
            if (this.logChannelId) {
                console.log(`🔍 Looking for channel with ID: ${this.logChannelId}`);
                logChannel = guild.channels.cache.get(this.logChannelId);
                if (!logChannel) {
                    console.warn(`⚠️ Voice log channel with ID "${this.logChannelId}" not found in ${guild.name}`);
                    console.warn(`💡 Check if the channel ID is correct: ${this.logChannelId}`);
                    
                    // List all channels for debugging
                    console.log(`📋 Available channels in ${guild.name}:`);
                    guild.channels.cache.forEach(ch => {
                        console.log(`  - ${ch.name} (${ch.type === 0 ? 'TEXT' : 'OTHER'}) - ID: ${ch.id}`);
                    });
                    return;
                } else {
                    console.log(`✅ Found log channel: ${logChannel.name} (ID: ${logChannel.id})`);
                }
            } else {
                // Fallback to finding by name
                console.log(`🔍 Looking for channel with name: ${this.logChannelName}`);
                logChannel = guild.channels.cache.find(channel => 
                    channel.name === this.logChannelName && channel.type === 0 // Text channel
                );

                if (!logChannel) {
                    // Only warn once per guild to avoid spam
                    if (!this.missingChannelWarned) {
                        console.warn(`⚠️ Voice log channel "${this.logChannelName}" not found in ${guild.name}`);
                        console.warn(`💡 Set VOICE_LOG_CHANNEL_ID=your_channel_id or create channel with: !createvoicelog`);
                        this.missingChannelWarned = true;
                    }
                    return;
                } else {
                    console.log(`✅ Found log channel by name: ${logChannel.name} (ID: ${logChannel.id})`);
                }
            }

            // Create embed based on action
            const embed = this.createLogEmbed(userId, username, channelId, channelName, action, additionalInfo);
            
            console.log(`📤 Sending ${action} embed to ${logChannel.name}...`);
            await logChannel.send({ embeds: [embed] });
            console.log(`✅ Successfully sent ${action} log for ${username}`);
            
        } catch (error) {
            console.error('❌ Error sending log message:', error);
            console.error('Full error details:', error.stack);
        }
    }

    createLogEmbed(userId, username, channelId, channelName, action, additionalInfo) {
        const embed = new EmbedBuilder()
            .setTimestamp() // This automatically uses Discord's timestamp system
            .setFooter({ text: 'Voice Activity Logger' }); // Remove timestamp from footer

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
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true },
                        { name: '🕐 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    );
                break;

            case 'LEAVE':
                embed
                    .setColor('#FF0000') // Red
                    .setTitle('👋 User Left Voice')
                    .setDescription(`${userMention} left ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true },
                        { name: '🕐 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
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
                        { name: '🏠 To', value: `${channelName || 'Unknown'}`, inline: true },
                        { name: '🕐 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
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
                        { name: '🔧 Action', value: action, inline: true },
                        { name: '🕐 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    );
        }

        return embed;
    }

    // Method to create log channel
    async createLogChannel(guild) {
        try {
            // If using channel ID, check if it exists
            if (this.logChannelId) {
                const existingChannel = guild.channels.cache.get(this.logChannelId);
                if (existingChannel) {
                    return existingChannel;
                } else {
                    console.warn(`⚠️ Channel ID ${this.logChannelId} not found, creating new channel with name: ${this.logChannelName}`);
                }
            }

            // Check if channel with name already exists
            const existingChannel = guild.channels.cache.find(channel => 
                channel.name === this.logChannelName && channel.type === 0
            );

            if (existingChannel) {
                console.log(`💡 Found existing channel: ${existingChannel.name} (ID: ${existingChannel.id})`);
                console.log(`💡 To use this channel, set VOICE_LOG_CHANNEL_ID=${existingChannel.id} in your .env`);
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

            console.log(`✅ Created voice log channel: ${newChannel.name} (ID: ${newChannel.id}) in ${guild.name}`);
            console.log(`💡 To use this channel permanently, set VOICE_LOG_CHANNEL_ID=${newChannel.id} in your .env`);
            return newChannel;
        } catch (error) {
            console.error('❌ Error creating voice log channel:', error);
            return null;
        }
    }
}

module.exports = ChannelLogger;
