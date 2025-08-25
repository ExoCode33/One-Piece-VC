// src/voiceTimeTracker.js
const ChannelLogger = require('./channelLogger');

class VoiceTimeTracker {
    constructor(client, pool) {
        this.client = client;
        this.pool = pool;
        this.activeSessions = new Map(); // userId -> { joinTime, channelId, channelName }
        this.channelLogger = new ChannelLogger(client); // Add channel logging
        
        // Initialize database table for voice time tracking
        this.initializeVoiceTimeTable();
        
        console.log('🔍 Voice Time Tracker initialized');
    }

    async initializeVoiceTimeTable() {
        try {
            // Drop old tables if they exist (database wipe)
            await this.pool.query('DROP TABLE IF EXISTS voice_activity_logs CASCADE');
            await this.pool.query('DROP TABLE IF EXISTS voice_time_tracking CASCADE');
            
            // Create new simplified voice time table
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS user_voice_time (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    guild_id VARCHAR(255) NOT NULL,
                    username VARCHAR(255) NOT NULL,
                    total_seconds BIGINT DEFAULT 0,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, guild_id)
                )
            `);

            // Create index for better performance
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_voice_time_lookup 
                ON user_voice_time(user_id, guild_id)
            `);

            console.log('✅ Voice time tracking table initialized (database wiped and recreated)');
        } catch (error) {
            console.error('❌ Error initializing voice time table:', error);
        }
    }

    async handleVoiceStateUpdate(oldState, newState) {
        if (!newState.member || newState.member.user.bot) return;

        const userId = newState.member.id;
        const username = newState.member.displayName;
        const guildId = newState.guild.id;

        // User joined voice
        if (!oldState.channelId && newState.channelId) {
            this.startSession(userId, username, guildId, newState.channelId, newState.channel.name);
            
            // Log to channel
            await this.channelLogger.logVoiceEvent(
                guildId, userId, username, newState.channelId, newState.channel.name, 'JOIN'
            );
        }
        // User left voice
        else if (oldState.channelId && !newState.channelId) {
            const sessionDuration = await this.endSession(userId, username, guildId);
            
            // Log to channel with duration
            await this.channelLogger.logVoiceEvent(
                guildId, userId, username, oldState.channelId, oldState.channel.name, 'LEAVE',
                { sessionDuration }
            );
        }
        // User moved between channels (end old session, start new one)
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            await this.endSession(userId, username, guildId);
            this.startSession(userId, username, guildId, newState.channelId, newState.channel.name);
            
            // Log to channel
            await this.channelLogger.logVoiceEvent(
                guildId, userId, username, newState.channelId, newState.channel.name, 'MOVE',
                { oldChannelName: oldState.channel.name }
            );
        }
    }

    startSession(userId, username, guildId, channelId, channelName) {
        this.activeSessions.set(userId, {
            joinTime: new Date(),
            channelId: channelId,
            channelName: channelName,
            username: username,
            guildId: guildId
        });
        
        console.log(`🎤 Started tracking: ${username} in ${channelName}`);
    }

    async endSession(userId, username, guildId) {
        const session = this.activeSessions.get(userId);
        if (!session) return 0;

        const duration = Math.floor((new Date() - session.joinTime) / 1000); // Duration in seconds
        
        if (duration > 0) { // Only record if session was longer than 0 seconds
            await this.addVoiceTime(userId, username, guildId, duration);
        }

        this.activeSessions.delete(userId);
        
        console.log(`👋 Ended tracking: ${username} - ${Math.floor(duration / 60)}m ${duration % 60}s`);
        return duration;
    }

    async addVoiceTime(userId, username, guildId, seconds) {
        try {
            await this.pool.query(`
                INSERT INTO user_voice_time (user_id, guild_id, username, total_seconds, last_updated)
                VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, guild_id) 
                DO UPDATE SET 
                    total_seconds = user_voice_time.total_seconds + EXCLUDED.total_seconds,
                    username = EXCLUDED.username,
                    last_updated = CURRENT_TIMESTAMP
            `, [userId, guildId, username, seconds]);
            
        } catch (error) {
            console.error('❌ Error adding voice time:', error);
        }
    }

    async getUserVoiceTime(userId, guildId) {
        try {
            const result = await this.pool.query(`
                SELECT total_seconds, username, last_updated
                FROM user_voice_time
                WHERE user_id = $1 AND guild_id = $2
            `, [userId, guildId]);
            
            if (result.rows.length > 0) {
                return result.rows[0];
            }
            
            return null;
        } catch (error) {
            console.error('❌ Error getting user voice time:', error);
            return null;
        }
    }

    async getTopVoiceUsers(guildId, limit = 10) {
        try {
            const result = await this.pool.query(`
                SELECT user_id, username, total_seconds, last_updated
                FROM user_voice_time
                WHERE guild_id = $1
                ORDER BY total_seconds DESC
                LIMIT $2
            `, [guildId, limit]);
            
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting top voice users:', error);
            return [];
        }
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            return `${remainingSeconds}s`;
        }
    }

    // Method to end all active sessions (for bot shutdown)
    async endAllSessions() {
        console.log(`⏱️ Ending ${this.activeSessions.size} active voice sessions...`);
        
        for (const [userId, session] of this.activeSessions) {
            await this.endSession(userId, session.username, session.guildId);
        }
    }

    // Get current active sessions count
    getActiveSessionsCount() {
        return this.activeSessions.size;
    }

    // Method to create log channel
    async createLogChannel(guild) {
        return await this.channelLogger.createLogChannel(guild);
    }
}

module.exports = VoiceTimeTracker;
