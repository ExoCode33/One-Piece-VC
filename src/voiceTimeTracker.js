// src/voiceTimeTracker.js - Enhanced with XP System
const ChannelLogger = require('./channelLogger');

class VoiceTimeTracker {
    constructor(client, pool) {
        this.client = client;
        this.pool = pool;
        this.activeSessions = new Map(); // userId -> { joinTime, channelId, channelName, xpEarned }
        this.channelLogger = new ChannelLogger(client);
        
        // XP Configuration
        this.XP_PER_MINUTE = parseInt(process.env.XP_PER_MINUTE) || 5; // XP earned per minute
        this.DAILY_XP_CAP = parseInt(process.env.DAILY_XP_CAP) || 500; // Daily XP cap
        this.WEEKLY_XP_CAP = parseInt(process.env.WEEKLY_XP_CAP) || 2500; // Weekly XP cap
        this.MONTHLY_XP_CAP = parseInt(process.env.MONTHLY_XP_CAP) || 10000; // Monthly XP cap
        
        // Initialize database table for voice time tracking with XP
        this.initializeVoiceTimeTable();
        
        console.log('🔍 Voice Time Tracker with XP System initialized');
        console.log(`⚡ XP Rate: ${this.XP_PER_MINUTE} XP/minute`);
        console.log(`📊 Daily Cap: ${this.DAILY_XP_CAP} XP | Weekly Cap: ${this.WEEKLY_XP_CAP} XP | Monthly Cap: ${this.MONTHLY_XP_CAP} XP`);
    }

    async initializeVoiceTimeTable() {
        try {
            // Drop old tables if they exist (database wipe)
            await this.pool.query('DROP TABLE IF EXISTS voice_activity_logs CASCADE');
            await this.pool.query('DROP TABLE IF EXISTS voice_time_tracking CASCADE');
            await this.pool.query('DROP TABLE IF EXISTS user_voice_time CASCADE');
            
            // Create new enhanced voice time table with XP tracking
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS user_voice_stats (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    guild_id VARCHAR(255) NOT NULL,
                    username VARCHAR(255) NOT NULL,
                    total_seconds BIGINT DEFAULT 0,
                    total_xp BIGINT DEFAULT 0,
                    daily_xp INTEGER DEFAULT 0,
                    weekly_xp INTEGER DEFAULT 0,
                    monthly_xp INTEGER DEFAULT 0,
                    daily_reset_date DATE DEFAULT CURRENT_DATE,
                    weekly_reset_date DATE DEFAULT CURRENT_DATE,
                    monthly_reset_date DATE DEFAULT CURRENT_DATE,
                    level_calculated INTEGER DEFAULT 1,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, guild_id)
                )
            `);

            // Create XP activity log table
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS xp_activity_log (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(255) NOT NULL,
                    guild_id VARCHAR(255) NOT NULL,
                    username VARCHAR(255) NOT NULL,
                    channel_name VARCHAR(255) NOT NULL,
                    session_duration_seconds INTEGER NOT NULL,
                    xp_earned INTEGER NOT NULL,
                    xp_cap_hit BOOLEAN DEFAULT FALSE,
                    cap_type VARCHAR(50), -- 'daily', 'weekly', 'monthly', or NULL
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create indexes for better performance
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_voice_stats_lookup 
                ON user_voice_stats(user_id, guild_id)
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_xp_activity_log_lookup 
                ON xp_activity_log(user_id, guild_id, timestamp)
            `);

            console.log('✅ Enhanced voice time tracking with XP system initialized (database wiped and recreated)');
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
            const sessionData = await this.endSession(userId, username, guildId);
            
            // Log to channel with duration and XP info
            await this.channelLogger.logVoiceEvent(
                guildId, userId, username, oldState.channelId, oldState.channel.name, 'LEAVE',
                { 
                    sessionDuration: sessionData.duration,
                    xpEarned: sessionData.xpEarned,
                    xpCapHit: sessionData.xpCapHit,
                    capType: sessionData.capType
                }
            );
        }
        // User moved between channels (end old session, start new one)
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            const sessionData = await this.endSession(userId, username, guildId);
            this.startSession(userId, username, guildId, newState.channelId, newState.channel.name);
            
            // Log to channel with XP info
            await this.channelLogger.logVoiceEvent(
                guildId, userId, username, newState.channelId, newState.channel.name, 'MOVE',
                { 
                    oldChannelName: oldState.channel.name,
                    xpEarned: sessionData.xpEarned,
                    xpCapHit: sessionData.xpCapHit
                }
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
        if (!session) return { duration: 0, xpEarned: 0, xpCapHit: false, capType: null };

        const duration = Math.floor((new Date() - session.joinTime) / 1000); // Duration in seconds
        let xpEarned = 0;
        let xpCapHit = false;
        let capType = null;

        if (duration > 0) {
            // Calculate XP (only award XP for full minutes)
            const minutesSpent = Math.floor(duration / 60);
            const potentialXP = minutesSpent * this.XP_PER_MINUTE;
            
            if (potentialXP > 0) {
                const xpResult = await this.calculateAndAwardXP(userId, username, guildId, duration, potentialXP, session.channelName);
                xpEarned = xpResult.xpAwarded;
                xpCapHit = xpResult.capHit;
                capType = xpResult.capType;
            }
        }

        this.activeSessions.delete(userId);
        
        const sessionData = { duration, xpEarned, xpCapHit, capType };
        console.log(`👋 Ended tracking: ${username} - ${Math.floor(duration / 60)}m ${duration % 60}s, +${xpEarned} XP${xpCapHit ? ` (${capType} cap hit)` : ''}`);
        
        return sessionData;
    }

    async calculateAndAwardXP(userId, username, guildId, sessionSeconds, potentialXP, channelName) {
        try {
            // Reset caps if needed and get current XP stats
            await this.resetCapsIfNeeded(userId, guildId);
            
            // Get current user stats
            const userStats = await this.getUserStats(userId, guildId);
            
            let currentDailyXP = userStats ? userStats.daily_xp : 0;
            let currentWeeklyXP = userStats ? userStats.weekly_xp : 0;
            let currentMonthlyXP = userStats ? userStats.monthly_xp : 0;
            
            // Calculate how much XP can actually be awarded
            let xpToAward = potentialXP;
            let capHit = false;
            let capType = null;
            
            // Check daily cap
            if (currentDailyXP + xpToAward > this.DAILY_XP_CAP) {
                xpToAward = Math.max(0, this.DAILY_XP_CAP - currentDailyXP);
                capHit = true;
                capType = 'daily';
            }
            
            // Check weekly cap
            if (currentWeeklyXP + xpToAward > this.WEEKLY_XP_CAP) {
                xpToAward = Math.min(xpToAward, Math.max(0, this.WEEKLY_XP_CAP - currentWeeklyXP));
                capHit = true;
                capType = 'weekly';
            }
            
            // Check monthly cap
            if (currentMonthlyXP + xpToAward > this.MONTHLY_XP_CAP) {
                xpToAward = Math.min(xpToAward, Math.max(0, this.MONTHLY_XP_CAP - currentMonthlyXP));
                capHit = true;
                capType = 'monthly';
            }
            
            // Award the XP
            if (xpToAward > 0) {
                await this.addVoiceTimeAndXP(userId, username, guildId, sessionSeconds, xpToAward);
            } else if (sessionSeconds > 0) {
                // Still record the time even if no XP awarded
                await this.addVoiceTimeAndXP(userId, username, guildId, sessionSeconds, 0);
            }
            
            // Log XP activity
            await this.logXPActivity(userId, username, guildId, channelName, sessionSeconds, xpToAward, capHit, capType);
            
            return {
                xpAwarded: xpToAward,
                capHit: capHit,
                capType: capType,
                potentialXP: potentialXP
            };
            
        } catch (error) {
            console.error('❌ Error calculating XP:', error);
            return { xpAwarded: 0, capHit: false, capType: null, potentialXP: 0 };
        }
    }

    async resetCapsIfNeeded(userId, guildId) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        
        try {
            // Get current reset dates
            const result = await this.pool.query(`
                SELECT daily_reset_date, weekly_reset_date, monthly_reset_date
                FROM user_voice_stats
                WHERE user_id = $1 AND guild_id = $2
            `, [userId, guildId]);
            
            if (result.rows.length === 0) return; // No user record yet
            
            const resetDates = result.rows[0];
            const currentDate = new Date(today);
            const dailyReset = new Date(resetDates.daily_reset_date);
            const weeklyReset = new Date(resetDates.weekly_reset_date);
            const monthlyReset = new Date(resetDates.monthly_reset_date);
            
            let updateQuery = 'UPDATE user_voice_stats SET ';
            let updates = [];
            let params = [];
            let paramCount = 1;
            
            // Check if daily reset needed
            if (currentDate > dailyReset) {
                updates.push(`daily_xp = 0, daily_reset_date = $${paramCount}`);
                params.push(today);
                paramCount++;
            }
            
            // Check if weekly reset needed (reset on Sunday)
            const daysSinceWeeklyReset = Math.floor((currentDate - weeklyReset) / (1000 * 60 * 60 * 24));
            if (daysSinceWeeklyReset >= 7) {
                const nextSunday = new Date(currentDate);
                nextSunday.setDate(currentDate.getDate() + (7 - currentDate.getDay()) % 7);
                updates.push(`weekly_xp = 0, weekly_reset_date = $${paramCount}`);
                params.push(nextSunday.toISOString().split('T')[0]);
                paramCount++;
            }
            
            // Check if monthly reset needed
            if (currentDate.getMonth() !== monthlyReset.getMonth() || currentDate.getFullYear() !== monthlyReset.getFullYear()) {
                const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
                updates.push(`monthly_xp = 0, monthly_reset_date = $${paramCount}`);
                params.push(nextMonth.toISOString().split('T')[0]);
                paramCount++;
            }
            
            if (updates.length > 0) {
                updateQuery += updates.join(', ');
                updateQuery += ` WHERE user_id = $${paramCount} AND guild_id = $${paramCount + 1}`;
                params.push(userId, guildId);
                
                await this.pool.query(updateQuery, params);
                console.log(`🔄 Reset XP caps for user ${userId}`);
            }
            
        } catch (error) {
            console.error('❌ Error resetting caps:', error);
        }
    }

    async addVoiceTimeAndXP(userId, username, guildId, seconds, xpToAdd) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const nextSunday = new Date();
            nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()) % 7);
            const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
            
            await this.pool.query(`
                INSERT INTO user_voice_stats (
                    user_id, guild_id, username, total_seconds, total_xp, daily_xp, weekly_xp, monthly_xp,
                    daily_reset_date, weekly_reset_date, monthly_reset_date, level_calculated, last_updated
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, guild_id) 
                DO UPDATE SET 
                    total_seconds = user_voice_stats.total_seconds + EXCLUDED.total_seconds,
                    total_xp = user_voice_stats.total_xp + EXCLUDED.total_xp,
                    daily_xp = user_voice_stats.daily_xp + EXCLUDED.daily_xp,
                    weekly_xp = user_voice_stats.weekly_xp + EXCLUDED.weekly_xp,
                    monthly_xp = user_voice_stats.monthly_xp + EXCLUDED.monthly_xp,
                    username = EXCLUDED.username,
                    level_calculated = FLOOR(SQRT(user_voice_stats.total_xp + EXCLUDED.total_xp) / 10) + 1,
                    last_updated = CURRENT_TIMESTAMP
            `, [
                userId, guildId, username, seconds, xpToAdd, xpToAdd, xpToAdd, xpToAdd,
                today, nextSunday.toISOString().split('T')[0], nextMonth.toISOString().split('T')[0],
                Math.floor(Math.sqrt(xpToAdd) / 10) + 1
            ]);
            
        } catch (error) {
            console.error('❌ Error adding voice time and XP:', error);
        }
    }

    async logXPActivity(userId, username, guildId, channelName, sessionSeconds, xpEarned, capHit, capType) {
        try {
            await this.pool.query(`
                INSERT INTO xp_activity_log (user_id, guild_id, username, channel_name, session_duration_seconds, xp_earned, xp_cap_hit, cap_type)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [userId, guildId, username, channelName, sessionSeconds, xpEarned, capHit, capType]);
            
        } catch (error) {
            console.error('❌ Error logging XP activity:', error);
        }
    }

    async getUserStats(userId, guildId) {
        try {
            const result = await this.pool.query(`
                SELECT * FROM user_voice_stats
                WHERE user_id = $1 AND guild_id = $2
            `, [userId, guildId]);
            
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            console.error('❌ Error getting user stats:', error);
            return null;
        }
    }

    async getUserVoiceTime(userId, guildId) {
        try {
            const result = await this.pool.query(`
                SELECT total_seconds, total_xp, daily_xp, weekly_xp, monthly_xp, level_calculated, username, last_updated
                FROM user_voice_stats
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
                SELECT user_id, username, total_seconds, total_xp, level_calculated, daily_xp, weekly_xp, monthly_xp, last_updated
                FROM user_voice_stats
                WHERE guild_id = $1
                ORDER BY total_xp DESC, total_seconds DESC
                LIMIT $2
            `, [guildId, limit]);
            
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting top voice users:', error);
            return [];
        }
    }

    async getXPCapsStatus(userId, guildId) {
        try {
            const stats = await this.getUserStats(userId, guildId);
            if (!stats) return null;
            
            return {
                daily: {
                    current: stats.daily_xp,
                    cap: this.DAILY_XP_CAP,
                    remaining: Math.max(0, this.DAILY_XP_CAP - stats.daily_xp),
                    percentage: Math.round((stats.daily_xp / this.DAILY_XP_CAP) * 100)
                },
                weekly: {
                    current: stats.weekly_xp,
                    cap: this.WEEKLY_XP_CAP,
                    remaining: Math.max(0, this.WEEKLY_XP_CAP - stats.weekly_xp),
                    percentage: Math.round((stats.weekly_xp / this.WEEKLY_XP_CAP) * 100)
                },
                monthly: {
                    current: stats.monthly_xp,
                    cap: this.MONTHLY_XP_CAP,
                    remaining: Math.max(0, this.MONTHLY_XP_CAP - stats.monthly_xp),
                    percentage: Math.round((stats.monthly_xp / this.MONTHLY_XP_CAP) * 100)
                }
            };
        } catch (error) {
            console.error('❌ Error getting XP caps status:', error);
            return null;
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
