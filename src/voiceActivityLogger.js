// src/voiceActivityLogger.js
const { EmbedBuilder } = require('discord.js');

class VoiceActivityLogger {
    constructor(client, pool) {
        this.client = client;
        this.pool = pool;
        this.logChannelName = process.env.VOICE_LOG_CHANNEL || 'voice-activity-log';
        this.enableLogging = process.env.ENABLE_VOICE_LOGGING === 'true';
        
        // Initialize database table for voice activity logs
        this.initializeVoiceLogTable();
        
        if (this.enableLogging) {
            console.log(`🔍 Voice Activity Logger initialized - Target channel: ${this.logChannelName}`);
        }
    }

    async initializeVoiceLogTable() {
        try {
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS voice_activity_logs (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    username VARCHAR(255) NOT NULL,
                    guild_id VARCHAR(255) NOT NULL,
                    channel_id VARCHAR(255),
                    channel_name VARCHAR(255),
                    action VARCHAR(50) NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    additional_info JSONB
                )
            `);

            // Create index for better performance
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_voice_logs_timestamp 
                ON voice_activity_logs(timestamp)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_voice_logs_user_guild 
                ON voice_activity_logs(user_id, guild_id)
            `);

            console.log('✅ Voice activity logs table initialized');
        } catch (error) {
            console.error('❌ Error initializing voice activity logs table:', error);
        }
    }

    async logVoiceActivity(userId, username, guildId, channelId, channelName, action, additionalInfo = {}) {
        try {
            // Store in database
            await this.pool.query(`
                INSERT INTO voice_activity_logs (user_id, username, guild_id, channel_id, channel_name, action, additional_info)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [userId, username, guildId, channelId, channelName, action, JSON.stringify(additionalInfo)]);

            // Send to log channel if enabled
            if (this.enableLogging) {
                await this.sendLogMessage(userId, username, guildId, channelId, channelName, action, additionalInfo);
            }
        } catch (error) {
            console.error('❌ Error logging voice activity:', error);
        }
    }

    async sendLogMessage(userId, username, guildId, channelId, channelName, action, additionalInfo) {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            // Find the log channel
            const logChannel = guild.channels.cache.find(channel => 
                channel.name === this.logChannelName && channel.type === 0 // Text channel
            );

            if (!logChannel) {
                // Only log this once per guild to avoid spam
                if (!this.missingChannelWarned) {
                    console.warn(`⚠️ Voice log channel "${this.logChannelName}" not found in ${guild.name}`);
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

            case 'MUTE':
                embed
                    .setColor('#808080') // Gray
                    .setTitle('🔇 User Muted')
                    .setDescription(`${userMention} was muted in ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true },
                        { name: '🔇 Type', value: additionalInfo.muteType || 'Unknown', inline: true }
                    );
                break;

            case 'UNMUTE':
                embed
                    .setColor('#00FFFF') // Cyan
                    .setTitle('🔊 User Unmuted')
                    .setDescription(`${userMention} was unmuted in ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true },
                        { name: '🔊 Type', value: additionalInfo.muteType || 'Unknown', inline: true }
                    );
                break;

            default:
                embed
                    .setColor('#FFFF00') // Yellow
                    .setTitle('❓ Unknown Voice Activity')
                    .setDescription(`${userMention} - ${action} in ${channelMention}`)
                    .addFields(
                        { name: '👤 User', value: `${username}`, inline: true },
                        { name: '🏠 Channel', value: `${channelName || 'Unknown'}`, inline: true },
                        { name: '🔧 Action', value: action, inline: true }
                    );
        }

        return embed;
    }

    // Enhanced voice state tracking with detailed logging
    async handleVoiceStateUpdate(oldState, newState) {
        if (!newState.member || newState.member.user.bot) return;

        const userId = newState.member.id;
        const username = newState.member.displayName;
        const guildId = newState.guild.id;

        // User joined voice
        if (!oldState.channelId && newState.channelId) {
            await this.logVoiceActivity(
                userId, 
                username, 
                guildId, 
                newState.channelId, 
                newState.channel.name, 
                'JOIN'
            );
        }
        // User left voice
        else if (oldState.channelId && !newState.channelId) {
            // Calculate session duration if we have tracking data
            let sessionDuration = null;
            if (this.voiceSessions && this.voiceSessions.has(userId)) {
                const session = this.voiceSessions.get(userId);
                sessionDuration = Math.floor((new Date() - session.joinTime) / 1000);
            }

            await this.logVoiceActivity(
                userId, 
                username, 
                guildId, 
                oldState.channelId, 
                oldState.channel.name, 
                'LEAVE',
                { sessionDuration }
            );
        }
        // User moved between channels
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            await this.logVoiceActivity(
                userId, 
                username, 
                guildId, 
                newState.channelId, 
                newState.channel.name, 
                'MOVE',
                { 
                    oldChannelId: oldState.channelId,
                    oldChannelName: oldState.channel.name 
                }
            );
        }
        // User mute/unmute status changed
        else if (oldState.channelId && newState.channelId && oldState.channelId === newState.channelId) {
            // Check for mute changes
            if (oldState.selfMute !== newState.selfMute) {
                await this.logVoiceActivity(
                    userId,
                    username,
                    guildId,
                    newState.channelId,
                    newState.channel.name,
                    newState.selfMute ? 'MUTE' : 'UNMUTE',
                    { muteType: 'Self Mute' }
                );
            }

            if (oldState.selfDeaf !== newState.selfDeaf) {
                await this.logVoiceActivity(
                    userId,
                    username,
                    guildId,
                    newState.channelId,
                    newState.channel.name,
                    newState.selfDeaf ? 'MUTE' : 'UNMUTE',
                    { muteType: 'Self Deafen' }
                );
            }

            if (oldState.serverMute !== newState.serverMute) {
                await this.logVoiceActivity(
                    userId,
                    username,
                    guildId,
                    newState.channelId,
                    newState.channel.name,
                    newState.serverMute ? 'MUTE' : 'UNMUTE',
                    { muteType: 'Server Mute' }
                );
            }

            if (oldState.serverDeaf !== newState.serverDeaf) {
                await this.logVoiceActivity(
                    userId,
                    username,
                    guildId,
                    newState.channelId,
                    newState.channel.name,
                    newState.serverDeaf ? 'MUTE' : 'UNMUTE',
                    { muteType: 'Server Deafen' }
                );
            }
        }
    }

    // Method to get recent voice activity logs
    async getRecentLogs(guildId, limit = 50) {
        try {
            const result = await this.pool.query(`
                SELECT user_id, username, channel_name, action, timestamp, additional_info
                FROM voice_activity_logs
                WHERE guild_id = $1
                ORDER BY timestamp DESC
                LIMIT $2
            `, [guildId, limit]);

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting recent voice logs:', error);
            return [];
        }
    }

    // Method to get user voice activity stats
    async getUserActivityStats(userId, guildId, days = 7) {
        try {
            const result = await this.pool.query(`
                SELECT 
                    action,
                    COUNT(*) as count,
                    DATE(timestamp) as date
                FROM voice_activity_logs
                WHERE user_id = $1 
                    AND guild_id = $2 
                    AND timestamp >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
                GROUP BY action, DATE(timestamp)
                ORDER BY date DESC, action
            `, [userId, guildId]);

            return result.rows;
        } catch (error) {
            console.error('❌ Error getting user activity stats:', error);
            return [];
        }
    }
}

module.exports = VoiceActivityLogger;
