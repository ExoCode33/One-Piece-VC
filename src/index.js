const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CREATE_CHANNEL_NAME = process.env.CREATE_CHANNEL_NAME || '🏴〢Set Sail Together';
const DEFAULT_CATEGORY_NAME = process.env.CATEGORY_NAME || '✘ 𝐕𝐨𝐢𝐜𝐞 𝐂𝐡𝐚𝐧𝐧𝐞𝐥𝐬 ✘';
const CATEGORY_ID = process.env.CATEGORY_ID; // Direct category ID override
const DELETE_DELAY = parseInt(process.env.DELETE_DELAY) || 1000;
const DEBUG = process.env.DEBUG === 'true';

// Audio Configuration
const AUDIO_VOLUME = parseFloat(process.env.AUDIO_VOLUME) || 0.4;

// PostgreSQL connection with auto-database creation
let pool;

async function initializeConnection() {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
        throw new Error('DATABASE_URL environment variable is required');
    }
    
    // Parse the database URL to get connection details
    const url = new URL(databaseUrl);
    const dbName = url.pathname.slice(1); // Remove leading slash
    
    // Create connection without database name first (to create database if needed)
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = '/postgres'; // Connect to default postgres database
    
    const adminPool = new Pool({
        connectionString: adminUrl.toString(),
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    try {
        // Check if database exists
        const result = await adminPool.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName]
        );
        
        if (result.rows.length === 0) {
            // Database doesn't exist, create it
            log(`🗄️ Database '${dbName}' doesn't exist, creating it...`);
            await adminPool.query(`CREATE DATABASE "${dbName}"`);
            log(`✅ Database '${dbName}' created successfully!`);
        } else {
            debugLog(`🗄️ Database '${dbName}' already exists`);
        }
        
        await adminPool.end();
        
        // Now create the main pool with the actual database
        pool = new Pool({
            connectionString: databaseUrl,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        log('🗄️ PostgreSQL connection established');
        
    } catch (error) {
        await adminPool.end();
        throw error;
    }
}

// One Piece themed channel names
const CREW_NAMES = [
    '🐠 Fish-Man Island',
    '🏝️ Skypiea Adventure',
    '🌸 Sakura Kingdom',
    '🏜️ Alabasta Palace',
    '🌋 Punk Hazard Lab',
    '🍭 Whole Cake Island',
    '🌺 Wano Country',
    '⚡ Thriller Bark',
    '🗿 Jaya Island',
    '🌊 Water 7 Docks',
    '🔥 Marineford War',
    '🏴‍☠️ Thousand Sunny',
    '⚓ Going Merry',
    '🦈 Arlong Park',
    '🎪 Buggy\'s Circus',
    '🍖 Baratie Restaurant',
    '📚 Ohara Library',
    '🌙 Zou Elephant',
    '⚔️ Dressrosa Colosseum',
    '🎭 Sabaody Archipelago',
    '🌟 Reverse Mountain',
    '🐉 Kaido\'s Lair',
    '🍃 Amazon Lily',
    '❄️ Drum Island',
    '🔱 Fishman District',
    '🌈 Long Ring Island',
    '🏰 Enies Lobby',
    '🌺 Rusukaina Island',
    '🔥 Ace\'s Adventure',
    '⚡ Enel\'s Ark'
];

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Track user voice sessions and audio connections
const voiceSessions = new Map(); // userId -> { sessionId, joinTime, channelId, channelName }
const activeConnections = new Map(); // channelId -> voice connection

// Audio file paths
const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');
const WELCOME_SOUND = path.join(SOUNDS_DIR, 'The Going Merry One Piece.ogg');

// Helper functions
function log(message) {
    console.log(`🏴‍☠️ ${message}`);
}

function debugLog(message) {
    if (DEBUG) {
        console.log(`🔍 DEBUG: ${message}`);
    }
}

function getRandomCrewName() {
    return CREW_NAMES[Math.floor(Math.random() * CREW_NAMES.length)];
}

// Database functions
async function initializeDatabase() {
    try {
        // Create guild_settings table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id VARCHAR(255) PRIMARY KEY,
                category_id VARCHAR(255) NOT NULL,
                category_name VARCHAR(255) NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create voice_time_tracking table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS voice_time_tracking (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                guild_id VARCHAR(255) NOT NULL,
                channel_id VARCHAR(255) NOT NULL,
                channel_name VARCHAR(255) NOT NULL,
                join_time TIMESTAMP NOT NULL,
                leave_time TIMESTAMP,
                duration_seconds INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for better performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_tracking_user_guild 
            ON voice_time_tracking(user_id, guild_id)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_tracking_join_time 
            ON voice_time_tracking(join_time)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_voice_tracking_duration 
            ON voice_time_tracking(duration_seconds)
        `);

        log('✅ Database tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
    }
}

async function getCategoryForGuild(guildId) {
    try {
        const result = await pool.query(
            'SELECT category_id, category_name FROM guild_settings WHERE guild_id = $1',
            [guildId]
        );
        
        if (result.rows.length > 0) {
            return {
                categoryId: result.rows[0].category_id,
                categoryName: result.rows[0].category_name
            };
        }
        
        return null;
    } catch (error) {
        console.error('❌ Error getting category from database:', error);
        return null;
    }
}

async function updateCategoryForGuild(guildId, categoryId, categoryName) {
    try {
        await pool.query(`
            INSERT INTO guild_settings (guild_id, category_id, category_name, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (guild_id) 
            DO UPDATE SET 
                category_id = EXCLUDED.category_id,
                category_name = EXCLUDED.category_name,
                updated_at = CURRENT_TIMESTAMP
        `, [guildId, categoryId, categoryName]);
        
        debugLog(`📝 Updated category for guild ${guildId}: ${categoryName} (${categoryId})`);
    } catch (error) {
        console.error('❌ Error updating category in database:', error);
    }
}

async function startVoiceSession(userId, guildId, channelId, channelName) {
    try {
        const result = await pool.query(`
            INSERT INTO voice_time_tracking (user_id, guild_id, channel_id, channel_name, join_time)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            RETURNING id
        `, [userId, guildId, channelId, channelName]);
        
        const sessionId = result.rows[0].id;
        voiceSessions.set(userId, {
            sessionId: sessionId,
            joinTime: new Date(),
            channelId: channelId,
            channelName: channelName
        });
        
        debugLog(`🎤 Started voice session for user ${userId} in ${channelName}`);
        return sessionId;
    } catch (error) {
        console.error('❌ Error starting voice session:', error);
        return null;
    }
}

async function endVoiceSession(userId) {
    try {
        const session = voiceSessions.get(userId);
        if (!session) {
            debugLog(`🤔 No active session found for user ${userId}`);
            return;
        }
        
        const duration = Math.floor((new Date() - session.joinTime) / 1000); // Duration in seconds
        
        await pool.query(`
            UPDATE voice_time_tracking 
            SET leave_time = CURRENT_TIMESTAMP, duration_seconds = $1
            WHERE id = $2
        `, [duration, session.sessionId]);
        
        voiceSessions.delete(userId);
        
        debugLog(`🎤 Ended voice session for user ${userId}. Duration: ${duration} seconds`);
        log(`⏱️ Voice session ended: ${Math.floor(duration / 60)}m ${duration % 60}s in ${session.channelName}`);
    } catch (error) {
        console.error('❌ Error ending voice session:', error);
    }
}

async function getUserVoiceStats(userId, guildId, days = 30) {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as session_count,
                SUM(duration_seconds) as total_seconds,
                AVG(duration_seconds) as avg_seconds,
                MAX(duration_seconds) as longest_seconds
            FROM voice_time_tracking 
            WHERE user_id = $1 
                AND guild_id = $2 
                AND join_time >= CURRENT_TIMESTAMP - INTERVAL '${days} days'
                AND duration_seconds IS NOT NULL
        `, [userId, guildId]);
        
        return result.rows[0];
    } catch (error) {
        console.error('❌ Error getting user voice stats:', error);
        return null;
    }
}

// Function to play welcome sound in a voice channel
async function playWelcomeSound(channel) {
    try {
        if (!fs.existsSync(WELCOME_SOUND)) {
            debugLog(`❌ Welcome sound file not found: ${WELCOME_SOUND}`);
            log(`⚠️ Create a 'sounds' folder and add 'The Going Merry One Piece.ogg' file`);
            return;
        }

        log(`🎵 Joining ${channel.name} for welcome sound...`);

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        activeConnections.set(channel.id, connection);

        const playAudio = () => {
            try {
                const player = createAudioPlayer();
                
                let resource;
                try {
                    resource = createAudioResource(WELCOME_SOUND, { 
                        inlineVolume: true,
                        inputType: 'arbitrary'
                    });
                } catch (ffmpegError) {
                    console.warn(`⚠️ FFmpeg issue, trying alternative:`, ffmpegError.message);
                    try {
                        resource = createAudioResource(WELCOME_SOUND);
                    } catch (fallbackError) {
                        console.error(`❌ Audio creation failed:`, fallbackError);
                        connection.destroy();
                        activeConnections.delete(channel.id);
                        return;
                    }
                }
                
                if (resource.volume) {
                    resource.volume.setVolume(AUDIO_VOLUME);
                }

                player.play(resource);
                connection.subscribe(player);
                
                log(`🎵 ✅ Playing welcome sound in ${channel.name}!`);

                player.on(AudioPlayerStatus.Idle, () => {
                    log(`🎵 Welcome sound finished, leaving ${channel.name}`);
                    // Leave immediately when sound finishes
                    if (activeConnections.has(channel.id)) {
                        const conn = activeConnections.get(channel.id);
                        conn.destroy();
                        activeConnections.delete(channel.id);
                    }
                });

                player.on('error', error => {
                    console.error(`❌ Audio error in ${channel.name}:`, error);
                    if (activeConnections.has(channel.id)) {
                        const conn = activeConnections.get(channel.id);
                        conn.destroy();
                        activeConnections.delete(channel.id);
                    }
                });
                
            } catch (audioError) {
                console.error(`❌ Audio setup error:`, audioError);
                connection.destroy();
                activeConnections.delete(channel.id);
            }
        };

        connection.on(VoiceConnectionStatus.Ready, () => {
            log(`✅ Connected to ${channel.name}, starting audio...`);
            playAudio();
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            activeConnections.delete(channel.id);
            debugLog(`🔌 Disconnected from ${channel.name}`);
        });

        connection.on('error', error => {
            console.error(`❌ Connection error in ${channel.name}:`, error);
            activeConnections.delete(channel.id);
        });

        // Faster timeout for connection issues
        setTimeout(() => {
            if (activeConnections.has(channel.id)) {
                const conn = activeConnections.get(channel.id);
                if (conn.state.status !== VoiceConnectionStatus.Ready) {
                    log(`⚠️ Connection timeout for ${channel.name}`);
                    conn.destroy();
                    activeConnections.delete(channel.id);
                }
            }
        }, 5000); // Reduced from 10 seconds to 5 seconds

    } catch (error) {
        console.error(`❌ Error joining ${channel.name}:`, error);
        if (activeConnections.has(channel.id)) {
            const conn = activeConnections.get(channel.id);
            conn.destroy();
            activeConnections.delete(channel.id);
        }
    }
}

// Function to sync channel permissions with category
async function syncChannelWithCategory(channel, category, creatorId) {
    try {
        // Get category permission overwrites
        const categoryPermissions = category.permissionOverwrites.cache;
        
        // Create permission overwrites array for the new channel
        const channelPermissions = [];
        
        // Copy all category permissions
        categoryPermissions.forEach((overwrite) => {
            channelPermissions.push({
                id: overwrite.id,
                allow: overwrite.allow,
                deny: overwrite.deny,
                type: overwrite.type
            });
        });
        
        // Add creator permissions (captain of the crew)
        const creatorPermissionExists = channelPermissions.find(perm => perm.id === creatorId);
        if (creatorPermissionExists) {
            // Merge with existing permissions
            creatorPermissionExists.allow = creatorPermissionExists.allow.add([
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers
            ]);
        } else {
            // Add new creator permissions
            channelPermissions.push({
                id: creatorId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.Connect,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.MoveMembers,
                    PermissionFlagsBits.MuteMembers,
                    PermissionFlagsBits.DeafenMembers
                ],
                type: 1 // Member type
            });
        }
        
        // Apply permissions to the channel
        await channel.permissionOverwrites.set(channelPermissions);
        
        debugLog(`🔐 Synced permissions for ${channel.name} with category ${category.name}`);
        debugLog(`👑 Granted captain permissions to creator ${creatorId}`);
        
    } catch (error) {
        console.error('❌ Error syncing channel permissions:', error);
    }
}

// Bot event handlers
client.once('ready', async () => {
    log(`One Piece Dynamic Voice Bot is ready to set sail!`);
    log(`⚓ Logged in as ${client.user.tag}`);
    log(`🏴‍☠️ Serving ${client.guilds.cache.size} server(s)`);
    log(`🔊 Audio Volume: ${Math.round(AUDIO_VOLUME * 100)}%`);
    
    // Check if welcome sound exists
    if (fs.existsSync(WELCOME_SOUND)) {
        const stats = fs.statSync(WELCOME_SOUND);
        log(`🎵 Welcome sound ready: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    } else {
        console.warn(`⚠️ Welcome sound not found at: ${WELCOME_SOUND}`);
        console.warn(`📁 Make sure the file exists in the sounds folder`);
    }
    
    // Check for FFmpeg availability
    try {
        const { spawn } = require('child_process');
        const ffmpeg = spawn('ffmpeg', ['-version']);
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                log(`🔧 FFmpeg is available - audio features enabled`);
            } else {
                console.warn(`⚠️ FFmpeg check failed with code ${code}`);
            }
        });
        ffmpeg.on('error', (error) => {
            console.warn(`⚠️ FFmpeg not found - audio features may not work`);
            console.warn(`💡 This is expected on some hosting platforms`);
        });
    } catch (error) {
        console.warn(`⚠️ Could not check FFmpeg availability`);
    }
    
    if (CATEGORY_ID) {
        log(`🎯 Using direct category ID: ${CATEGORY_ID}`);
    } else {
        log(`📁 Using dynamic category management`);
    }
    
    try {
        // Initialize database connection and create database if needed
        await initializeConnection();
        
        // Initialize database tables
        await initializeDatabase();
        
        // Test database connection
        const result = await pool.query('SELECT NOW()');
        log(`⏰ Database time: ${result.rows[0].now}`);
        log('🗄️ Database connection test successful!');
        
        // Set up voice tracking for existing voice channel users
        log('🔍 Checking for existing voice channel users...');
        client.guilds.cache.forEach(guild => {
            guild.channels.cache
                .filter(channel => 
                    channel.type === ChannelType.GuildVoice && 
                    channel.members.size > 0 &&
                    channel.name !== CREATE_CHANNEL_NAME // Skip trigger channel
                )
                .forEach(channel => {
                    channel.members.forEach(member => {
                        if (!member.user.bot) {
                            const userId = member.id;
                            const guildId = guild.id;
                            const channelId = channel.id;
                            
                            // Start tracking existing users
                            startVoiceSession(userId, guildId, channelId, channel.name);
                            
                            log(`🔄 Now tracking existing user: ${member.displayName} in ${channel.name}`);
                        }
                    });
                });
        });
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        console.error('❌ Bot will shut down due to database error');
        process.exit(1);
    }
});

// Voice state update handler
client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id;
    const member = newState.member;
    const guildId = newState.guild.id;

    try {
        // Handle voice session tracking
        if (oldState.channelId && !newState.channelId) {
            // User left voice completely
            await endVoiceSession(userId);
            debugLog(`👤 ${member.displayName} left voice chat`);
        } else if (!oldState.channelId && newState.channelId) {
            // User joined voice
            await startVoiceSession(userId, guildId, newState.channelId, newState.channel.name);
            debugLog(`👤 ${member.displayName} joined ${newState.channel.name}`);
        } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            // User moved between channels
            await endVoiceSession(userId);
            await startVoiceSession(userId, guildId, newState.channelId, newState.channel.name);
            debugLog(`👤 ${member.displayName} moved from ${oldState.channel.name} to ${newState.channel.name}`);
        }

        // Dynamic Voice Channel Creation
        if (newState.channelId && newState.channel?.name === CREATE_CHANNEL_NAME) {
            const guild = newState.guild;
            
            if (!member.voice.channelId) {
                debugLog(`User ${member.displayName} no longer in voice, skipping channel creation`);
                return;
            }
            
            let category;
            
            // If CATEGORY_ID is provided, use it directly
            if (CATEGORY_ID) {
                category = guild.channels.cache.get(CATEGORY_ID);
                if (category) {
                    debugLog(`✅ Using direct category ID: ${CATEGORY_ID} (${category.name})`);
                    // Save/update this category in database
                    await updateCategoryForGuild(guildId, category.id, category.name);
                } else {
                    console.error(`❌ Category with ID ${CATEGORY_ID} not found! Creating fallback category.`);
                }
            }
            
            // If no direct category ID or category not found, use saved/default logic
            if (!category) {
                // Get saved category or use default
                let savedCategory = await getCategoryForGuild(guildId);
                
                if (savedCategory) {
                    // Try to find the saved category by ID first
                    category = guild.channels.cache.get(savedCategory.categoryId);
                    if (!category) {
                        // Saved category doesn't exist anymore, find by name
                        category = guild.channels.cache.find(c => 
                            c.name === savedCategory.categoryName && c.type === ChannelType.GuildCategory
                        );
                        
                        if (category) {
                            // Update the database with the new category ID
                            await updateCategoryForGuild(guildId, category.id, category.name);
                            log(`🔄 Category ID updated: ${savedCategory.categoryName}`);
                        }
                    }
                }
                
                if (!category) {
                    // Create new category with default name
                    debugLog(`Category not found, creating new one: ${DEFAULT_CATEGORY_NAME}`);
                    category = await guild.channels.create({
                        name: DEFAULT_CATEGORY_NAME,
                        type: ChannelType.GuildCategory,
                    });
                    
                    // Save the new category to database
                    await updateCategoryForGuild(guildId, category.id, category.name);
                    log(`📁 Created and saved new category: ${DEFAULT_CATEGORY_NAME}`);
                }
            }

            const crewName = getRandomCrewName();
            
            // Create the new voice channel with basic setup first
            const newChannel = await guild.channels.create({
                name: crewName,
                type: ChannelType.GuildVoice,
                parent: category.id,
            });

            // Sync permissions with category and add creator permissions
            await syncChannelWithCategory(newChannel, category, member.id);

            // Ensure channel is in the correct category
            if (newChannel.parentId !== category.id) {
                try {
                    await newChannel.setParent(category.id);
                    debugLog(`🔧 Manually moved ${crewName} to category ${category.name}`);
                } catch (moveError) {
                    console.error(`❌ Error moving channel to category:`, moveError);
                }
            }

            log(`🚢 Created new crew: ${crewName} for ${member.displayName}`);
            log(`👑 ${member.displayName} is now captain of ${crewName}`);

            try {
                if (member.voice.channelId) {
                    await member.voice.setChannel(newChannel);
                    debugLog(`✅ Successfully moved ${member.displayName} to ${crewName}`);
                    
                    // Play welcome sound immediately after moving user
                    log(`🎵 Playing welcome sound in ${crewName}...`);
                    setTimeout(() => {
                        playWelcomeSound(newChannel);
                    }, 1500); // Reduced from 3 seconds to 1.5 seconds
                    
                } else {
                    debugLog(`User ${member.displayName} disconnected before move, cleaning up channel`);
                    setTimeout(async () => {
                        try {
                            if (newChannel.members.size === 0) {
                                await newChannel.delete();
                                debugLog(`🗑️ Cleaned up unused crew: ${crewName}`);
                            }
                        } catch (cleanupError) {
                            console.error(`❌ Error cleaning up channel:`, cleanupError);
                        }
                    }, 1000);
                }
            } catch (moveError) {
                console.error(`❌ Error moving user to new channel:`, moveError);
                setTimeout(async () => {
                    try {
                        if (newChannel.members.size === 0) {
                            await newChannel.delete();
                            debugLog(`🗑️ Cleaned up failed crew: ${crewName}`);
                        }
                    } catch (cleanupError) {
                        console.error(`❌ Error cleaning up channel:`, cleanupError);
                    }
                }, 1000);
            }
        }

        // Auto-delete empty dynamic channels
        if (oldState.channelId) {
            const oldChannel = oldState.channel;
            const savedCategory = await getCategoryForGuild(guildId);
            const categoryName = savedCategory ? savedCategory.categoryName : DEFAULT_CATEGORY_NAME;
            
            if (oldChannel && 
                oldChannel.name !== CREATE_CHANNEL_NAME && 
                oldChannel.parent?.name === categoryName &&
                oldChannel.members.size === 0) {
                
                debugLog(`🕐 Scheduling deletion of empty crew: ${oldChannel.name} in ${DELETE_DELAY}ms`);
                
                // Clean up any voice connections for this channel
                if (activeConnections.has(oldChannel.id)) {
                    const connection = activeConnections.get(oldChannel.id);
                    connection.destroy();
                    activeConnections.delete(oldChannel.id);
                    debugLog(`🔌 Cleaned up voice connection for ${oldChannel.name}`);
                }
                
                setTimeout(async () => {
                    try {
                        const channelToDelete = oldChannel.guild.channels.cache.get(oldChannel.id);
                        if (channelToDelete && channelToDelete.members.size === 0) {
                            await channelToDelete.delete();
                            log(`🗑️ Deleted empty crew: ${oldChannel.name}`);
                        } else {
                            debugLog(`👥 Crew ${oldChannel.name} no longer empty, keeping it`);
                        }
                    } catch (error) {
                        console.error(`❌ Error deleting channel ${oldChannel.name}:`, error);
                    }
                }, DELETE_DELAY);
            }
        }

    } catch (error) {
        console.error('❌ Error in voiceStateUpdate:', error);
    }
});

// Handle category moves - sync to database when category is moved/renamed
client.on('channelUpdate', async (oldChannel, newChannel) => {
    try {
        // Check if this is a category update
        if (newChannel.type === ChannelType.GuildCategory) {
            const guildId = newChannel.guild.id;
            const savedCategory = await getCategoryForGuild(guildId);
            
            // If this is our saved category and it was moved/renamed
            if (savedCategory && savedCategory.categoryId === newChannel.id) {
                if (savedCategory.categoryName !== newChannel.name) {
                    await updateCategoryForGuild(guildId, newChannel.id, newChannel.name);
                    log(`📁 Category renamed and synced: ${savedCategory.categoryName} → ${newChannel.name}`);
                }
            }
        }
    } catch (error) {
        console.error('❌ Error handling category update:', error);
    }
});

// Message commands for voice stats and bot management
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Voice stats command
    if (message.content === '!voicestats' || message.content === '!stats') {
        try {
            const stats = await getUserVoiceStats(message.author.id, message.guild.id);
            if (stats && stats.total_seconds > 0) {
                const totalHours = Math.floor(stats.total_seconds / 3600);
                const totalMinutes = Math.floor((stats.total_seconds % 3600) / 60);
                const avgMinutes = Math.floor(stats.avg_seconds / 60);
                const longestHours = Math.floor(stats.longest_seconds / 3600);
                const longestMinutes = Math.floor((stats.longest_seconds % 3600) / 60);
                
                message.reply(`📊 **${message.author.displayName}'s Voice Stats (Last 30 days)**\n` +
                    `🎤 **Sessions:** ${stats.session_count}\n` +
                    `⏱️ **Total Time:** ${totalHours}h ${totalMinutes}m\n` +
                    `📈 **Average Session:** ${avgMinutes}m\n` +
                    `🏆 **Longest Session:** ${longestHours}h ${longestMinutes}m`);
            } else {
                message.reply('📊 No voice activity recorded in the last 30 days! Join some voice channels to start tracking your stats! 🎤');
            }
        } catch (error) {
            console.error('❌ Error getting voice stats:', error);
            message.reply('❌ Error retrieving voice stats. Please try again later.');
        }
    }
    
    // Ping command
    if (message.content === '!ping') {
        const ping = Date.now() - message.createdTimestamp;
        message.reply(`🏴‍☠️ **Pong!** 
📡 Bot Latency: \`${ping}ms\`
💓 API Latency: \`${Math.round(client.ws.ping)}ms\`
⚓ Ready to set sail!`);
    }
    
    // Bot info command
    if (message.content === '!botinfo') {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        message.reply(`🏴‍☠️ **One Piece Voice Bot Info**
⚓ **Servers:** ${client.guilds.cache.size}
👤 **Active Voice Sessions:** ${voiceSessions.size}
🎵 **Active Audio Connections:** ${activeConnections.size}
⏰ **Uptime:** ${hours}h ${minutes}m
🗄️ **Database:** Connected
🎤 **Features:** Dynamic Voice Channels, Voice Time Tracking, Welcome Sounds`);
    }
    
    // Fast sound test command for speed testing
    if (message.content === '!fastsound') {
        if (!message.member.voice.channel) {
            return message.reply('❌ You need to be in a voice channel!');
        }
        
        const startTime = Date.now();
        message.reply('🎵 Testing fast welcome sound...').then(() => {
            playWelcomeSound(message.member.voice.channel);
            
            // Report timing
            setTimeout(() => {
                const totalTime = Date.now() - startTime;
                message.channel.send(`⏱️ **Speed Test Results:**
🚀 **Total time:** ${totalTime}ms
🎯 **Target:** Under 2000ms for good performance`);
            }, 3000);
        });
    }
    if (message.content === '!testsound') {
        if (!message.member.voice.channel) {
            return message.reply('❌ You need to be in a voice channel to test the sound!');
        }
        
        message.reply('🎵 Testing welcome sound...');
        playWelcomeSound(message.member.voice.channel);
    }
    
    // Check sound file command
    if (message.content === '!checksound') {
        if (fs.existsSync(WELCOME_SOUND)) {
            const stats = fs.statSync(WELCOME_SOUND);
            message.reply(`✅ **Sound file found!**
📁 **Path:** \`${WELCOME_SOUND}\`
📏 **Size:** ${(stats.size / 1024 / 1024).toFixed(2)} MB
🔊 **Volume:** ${Math.round(AUDIO_VOLUME * 100)}%`);
        } else {
            message.reply(`❌ **Sound file NOT found!**
📁 **Expected path:** \`${WELCOME_SOUND}\`
💡 **Solution:** Create a 'sounds' folder and add 'The Going Merry One Piece.ogg'`);
        }
    }
    
    // Help command
    if (message.content === '!help') {
        message.reply(`🏴‍☠️ **One Piece Voice Bot Commands**

**📊 Voice Tracking:**
\`!voicestats\` or \`!stats\` - View your voice activity stats
\`!ping\` - Check bot latency
\`!botinfo\` - View bot information
\`!help\` - Show this help message

**🎵 Audio Testing:**
\`!testsound\` - Test welcome sound in your current voice channel
\`!fastsound\` - Speed test for bot join/play/leave timing
\`!checksound\` - Check if sound file exists and show details

**🚢 How to Use:**
1. Join "${CREATE_CHANNEL_NAME}" voice channel
2. Bot will create a new crew with a One Piece themed name
3. You become the captain with full channel permissions
4. Bot plays welcome sound (if file exists)
5. Empty crews are automatically deleted after ${DELETE_DELAY/1000} seconds
6. Your voice time is automatically tracked!

**🎯 Features:**
• Dynamic voice channel creation
• Auto-synced category permissions
• Voice time tracking with PostgreSQL
• Captain permissions for channel creators
• Automatic cleanup of empty channels
• Welcome sounds with The Going Merry theme`);
    }
});

// Error handling
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

client.on('warn', warning => {
    console.warn('⚠️ Discord client warning:', warning);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function gracefulShutdown() {
    log('🛑 Shutting down bot gracefully...');
    
    try {
        // End all active voice sessions
        log(`⏱️ Ending ${voiceSessions.size} active voice sessions...`);
        for (const [userId] of voiceSessions) {
            await endVoiceSession(userId);
        }
        
        // Clean up voice connections
        log(`🔌 Cleaning up ${activeConnections.size} voice connections...`);
        activeConnections.forEach((connection, key) => {
            try {
                connection.destroy();
                debugLog(`🔌 Destroyed connection for ${key}`);
            } catch (error) {
                // Ignore errors during shutdown
            }
        });
        activeConnections.clear();
        
        // Close database connection
        log('🗄️ Closing database connection...');
        if (pool) {
            await pool.end();
        }
        
        // Destroy Discord client
        client.destroy();
        
        log('👋 Bot shutdown complete!');
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
    }
    
    process.exit(0);
}

// Keep the process alive and log status
setInterval(() => {
    if (DEBUG) {
        console.log(`🏴‍☠️ Bot Status - Guilds: ${client.guilds.cache.size}, Active Voice Sessions: ${voiceSessions.size}, Audio Connections: ${activeConnections.size}, Uptime: ${Math.floor(process.uptime()/60)}m`);
    }
}, 300000); // Log every 5 minutes in debug mode

// Start the bot
async function startBot() {
    log('🚀 Starting One Piece Dynamic Voice Bot...');
    log(`🔑 Discord Token: ${DISCORD_TOKEN ? '✅ Provided' : '❌ MISSING'}`);
    log(`🆔 Client ID: ${CLIENT_ID ? '✅ Provided' : '❌ MISSING'}`);
    log(`🗄️ Database URL: ${process.env.DATABASE_URL ? '✅ Provided' : '❌ MISSING'}`);

    if (!DISCORD_TOKEN) {
        console.error('❌ DISCORD_TOKEN is required! Please check your .env file.');
        process.exit(1);
    }

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL is required! Please check your .env file.');
        process.exit(1);
    }

    try {
        await client.login(DISCORD_TOKEN);
    } catch (error) {
        console.error('❌ Failed to login to Discord:', error);
        process.exit(1);
    }
}

// Start the bot
startBot();
