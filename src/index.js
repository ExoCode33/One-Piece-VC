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

// AFK Management Configuration
const AFK_TIMEOUT = parseInt(process.env.AFK_TIMEOUT) || 900000; // 15 minutes default
const AFK_EXCLUDED_CHANNELS = process.env.AFK_EXCLUDED_CHANNELS ? 
    process.env.AFK_EXCLUDED_CHANNELS.split(',').map(name => name.trim()) : 
    ['🌇〢Lofi'];
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

// Track user voice sessions and AFK status
const voiceSessions = new Map(); // userId -> { sessionId, joinTime, channelId, channelName }
const afkUsers = new Map(); // userId -> { channelId, startTime, isAfk }
const activeConnections = new Map(); // channelId -> voice connection

// Audio file paths
const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');
const WELCOME_SOUND = path.join(SOUNDS_DIR, 'The Going Merry One Piece.ogg');

// One Piece themed disconnect messages for AFK users
const onePieceDisconnectMessages = [
    "🌊 {user} got swept away by the Grand Line currents!",
    "💤 {user} fell asleep like Zoro during navigation...",
    "🏃 {user} ran away from the Marines!",
    "🍖 {user} went hunting for Sea King meat!",
    "⚓ {user} got lost like Zoro (auto-disconnected)",
    "🌪️ {user} was caught in a sudden storm!",
    "🏝️ {user} went exploring a mysterious island!",
    "🎣 {user} went fishing with Usopp!",
    "🍺 {user} passed out from too much sake!",
    "📚 {user} fell asleep reading poneglyphs with Robin...",
    "🎵 {user} drifted away listening to Brook's music!",
    "⚡ {user} was struck by Enel's lightning!",
    "🌸 {user} got distracted by cherry blossoms in Wano!",
    "🐟 {user} went swimming with the Fish-Men!",
    "🔥 {user} got too close to Ace's flames!"
];

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

// AFK Management Functions
function isUserAFK(voiceState) {
    // Don't use mute/deafen status for AFK detection
    // AFK will be determined by voice activity/inactivity instead
    return false; // Always return false, we'll track activity differently
}

function trackAFKUser(userId, channelId, isAfk = false) {
    afkUsers.set(userId, {
        channelId: channelId,
        lastActivity: Date.now(), // Track last voice activity
        isAfk: false // Start as active
    });
    
    if (DEBUG) {
        debugLog(`👁️ Now tracking voice activity for user ${userId} in channel ${channelId}`);
    }
}

function updateUserActivity(userId) {
    const userData = afkUsers.get(userId);
    if (userData) {
        userData.lastActivity = Date.now();
        userData.isAfk = false;
        
        if (DEBUG) {
            debugLog(`🎤 Voice activity detected for user ${userId}`);
        }
    }
}

function updateAFKStatus(userId, channelId, isAfk) {
    // This function is no longer needed since we're not using mute/deafen status
    // But keeping it for compatibility
}

function stopTrackingAFK(userId) {
    afkUsers.delete(userId);
    if (DEBUG) {
        debugLog(`👋 Stopped tracking AFK for user ${userId}`);
    }
}

function isChannelExcluded(channelName) {
    return AFK_EXCLUDED_CHANNELS.some(excludedName => 
        channelName.toLowerCase().includes(excludedName.toLowerCase()) ||
        excludedName.toLowerCase().includes(channelName.toLowerCase())
    );
}

async function checkAFKUsers() {
    const now = Date.now();
    const usersToDisconnect = [];

    for (const [userId, userData] of afkUsers.entries()) {
        const inactiveTime = now - userData.lastActivity;
        
        // Check if user has been inactive for longer than AFK_TIMEOUT
        if (inactiveTime >= AFK_TIMEOUT) {
            try {
                const guild = client.guilds.cache.first(); // Assuming single guild for now
                if (!guild) continue;
                
                const member = await guild.members.fetch(userId).catch(() => null);
                const channel = guild.channels.cache.get(userData.channelId);
                
                if (member && member.voice.channel && channel) {
                    // Check if user is in an excluded channel
                    if (isChannelExcluded(channel.name)) {
                        if (DEBUG) {
                            debugLog(`🛡️ User ${member.displayName} is in protected channel: ${channel.name}`);
                        }
                        continue;
                    }
                    
                    usersToDisconnect.push({ member, channel, inactiveTime });
                }
            } catch (error) {
                console.error(`❌ Error checking AFK user ${userId}:`, error);
                stopTrackingAFK(userId);
            }
        }
    }

    // Disconnect AFK users
    for (const { member, channel, inactiveTime } of usersToDisconnect) {
        await disconnectAFKUser(member, channel, inactiveTime);
    }
}

async function disconnectAFKUser(member, channel, inactiveTime) {
    try {
        // Disconnect the user
        await member.voice.disconnect('AFK timeout - no voice activity');
        stopTrackingAFK(member.id);
        
        // Get random disconnect message
        const randomMessage = onePieceDisconnectMessages[
            Math.floor(Math.random() * onePieceDisconnectMessages.length)
        ].replace('{user}', member.displayName);
        
        // Send notification to a general channel if available
        const guild = member.guild;
        const generalChannel = guild.channels.cache.find(ch => 
            ch.type === 0 && (ch.name.includes('general') || ch.name.includes('chat'))
        );
        
        if (generalChannel) {
            const embed = {
                color: 0xFF6B6B,
                title: '⚓ Crew Member Lost at Sea!',
                description: randomMessage,
                fields: [
                    { name: '🏴‍☠️ Former Location', value: channel.name, inline: true },
                    { name: '😴 Inactive Duration', value: `${Math.floor(inactiveTime / 60000)} minutes`, inline: true }
                ],
                footer: { text: 'Return when you\'re ready to set sail again!' },
                timestamp: new Date().toISOString()
            };

            await generalChannel.send({ embeds: [embed] });
        }
        
        log(`🌊 Disconnected inactive user: ${member.displayName} from ${channel.name} (inactive for ${Math.floor(inactiveTime / 60000)} minutes)`);
        
    } catch (error) {
        console.error(`❌ Error disconnecting inactive user ${member.displayName}:`, error);
    }
}

// Function to play welcome sound in a voice channel
async function playWelcomeSound(channel) {
    try {
        if (!fs.existsSync(WELCOME_SOUND)) {
            debugLog(`Welcome sound file not found: ${WELCOME_SOUND}`);
            return;
        }

        debugLog(`🎵 Playing welcome sound in ${channel.name}`);

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        activeConnections.set(channel.id, connection);

        const player = createAudioPlayer();
        const resource = createAudioResource(WELCOME_SOUND, { 
            inlineVolume: true 
        });
        
        resource.volume.setVolume(AUDIO_VOLUME);

        player.play(resource);
        connection.subscribe(player);

        player.on(AudioPlayerStatus.Playing, () => {
            debugLog(`🎵 ✅ Welcome sound playing in ${channel.name}`);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            debugLog(`🎵 Welcome sound finished in ${channel.name}`);
            // Disconnect after sound finishes
            setTimeout(() => {
                if (activeConnections.has(channel.id)) {
                    const conn = activeConnections.get(channel.id);
                    conn.destroy();
                    activeConnections.delete(channel.id);
                    debugLog(`🔌 Disconnected from ${channel.name} after welcome sound`);
                }
            }, 2000); // Wait 2 seconds before disconnecting
        });

        player.on('error', error => {
            console.error(`❌ Audio player error in ${channel.name}:`, error);
            if (activeConnections.has(channel.id)) {
                const conn = activeConnections.get(channel.id);
                conn.destroy();
                activeConnections.delete(channel.id);
            }
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            debugLog(`🔌 Voice connection ready in ${channel.name}`);
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            debugLog(`🔌 Voice connection disconnected from ${channel.name}`);
            activeConnections.delete(channel.id);
        });

        connection.on('error', error => {
            console.error(`❌ Voice connection error in ${channel.name}:`, error);
            activeConnections.delete(channel.id);
        });

    } catch (error) {
        console.error(`❌ Error playing welcome sound in ${channel.name}:`, error);
    }
}
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
    log(`🛡️ AFK Protection: ${AFK_EXCLUDED_CHANNELS.join(', ')}`);
    log(`⏰ AFK Timeout: ${AFK_TIMEOUT / 60000} minutes`);
    log(`😴 AFK Detection: Voice inactivity (ignores mute/deafen status)`);
    log(`🔊 Audio Volume: ${Math.round(AUDIO_VOLUME * 100)}%`);
    
    // Check if welcome sound exists
    if (fs.existsSync(WELCOME_SOUND)) {
        const stats = fs.statSync(WELCOME_SOUND);
        log(`🎵 Welcome sound ready: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    } else {
        console.warn(`⚠️ Welcome sound not found at: ${WELCOME_SOUND}`);
        console.warn(`📁 Make sure the file exists in the sounds folder`);
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
        
        // Start AFK monitoring
        log('🏴‍☠️ AFK Manager: Started monitoring for inactive pirates...');
        setInterval(checkAFKUsers, 60000); // Check every minute
        
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
            stopTrackingAFK(userId);
            debugLog(`👤 ${member.displayName} left voice chat`);
        } else if (!oldState.channelId && newState.channelId) {
            // User joined voice
            await startVoiceSession(userId, guildId, newState.channelId, newState.channel.name);
            trackAFKUser(userId, newState.channelId);
            debugLog(`👤 ${member.displayName} joined ${newState.channel.name}`);
        } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            // User moved between channels
            await endVoiceSession(userId);
            await startVoiceSession(userId, guildId, newState.channelId, newState.channel.name);
            trackAFKUser(userId, newState.channelId);
            debugLog(`👤 ${member.displayName} moved from ${oldState.channel.name} to ${newState.channel.name}`);
        } else if (newState.channelId) {
            // User's state changed (muted/deafened) while in same channel
            // Update their activity timestamp since any state change indicates they're active
            updateUserActivity(userId);
            debugLog(`🎛️ ${member.displayName} changed voice state (still active)`);
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
                    
                    // Play welcome sound after moving user
                    setTimeout(() => {
                        playWelcomeSound(newChannel);
                    }, 1000); // Wait 1 second for user to fully connect
                    
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
                
                // Clean up any voice connection for this channel
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

// Listen for speaking events to detect voice activity
client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member || oldState.member;
    const userId = member.id;
    
    // Set up speaking detection when user joins a channel
    if (newState.channel && !oldState.channel) {
        // User joined a channel, start monitoring their voice activity
        const connection = newState.guild.voiceAdapterCreator.createAdapter(newState.channel);
        if (connection) {
            // Note: Discord.js v14 doesn't have direct speaking events
            // We'll rely on state changes and periodic checks for now
            // Any voice state change indicates activity
            updateUserActivity(userId);
        }
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
😴 **AFK Users Tracked:** ${afkUsers.size}
🎵 **Active Audio Connections:** ${activeConnections.size}
⏰ **Uptime:** ${hours}h ${minutes}m
🗄️ **Database:** Connected
🎤 **Features:** Dynamic Voice Channels, Voice Time Tracking, AFK Management, Welcome Sounds`);
    }
    
    // AFK stats command
    if (message.content === '!afkstats') {
        try {
            const totalTracked = afkUsers.size;
            const now = Date.now();
            let currentlyInactive = 0;
            
            // Count users who have been inactive for more than 5 minutes
            for (const [userId, userData] of afkUsers.entries()) {
                const inactiveTime = now - userData.lastActivity;
                if (inactiveTime >= 300000) { // 5 minutes
                    currentlyInactive++;
                }
            }
            
            message.reply(`📊 **AFK System Stats**
👁️ **Users Tracked:** ${totalTracked}
😴 **Inactive (5+ min):** ${currentlyInactive}
⏰ **Disconnect Timeout:** ${AFK_TIMEOUT / 60000} minutes
🛡️ **Protected Channels:** ${AFK_EXCLUDED_CHANNELS.join(', ')}
🎤 **Detection Method:** Voice inactivity (ignores mute/deafen)`);
        } catch (error) {
            console.error('❌ Error getting AFK stats:', error);
            message.reply('❌ Error retrieving AFK stats.');
        }
    }
    
    // Help command
    if (message.content === '!help') {
        message.reply(`🏴‍☠️ **One Piece Voice Bot Commands**

**📊 Voice Tracking:**
\`!voicestats\` or \`!stats\` - View your voice activity stats
\`!afkstats\` - View AFK system statistics
\`!ping\` - Check bot latency
\`!botinfo\` - View bot information
\`!help\` - Show this help message

**🚢 How to Use:**
1. Join "${CREATE_CHANNEL_NAME}" voice channel
2. Bot will create a new crew with a One Piece themed name
3. You become the captain with full channel permissions
4. Empty crews are automatically deleted after ${DELETE_DELAY/1000} seconds
5. Your voice time is automatically tracked!

**😴 AFK Management:**
• Users disconnected after ${AFK_TIMEOUT/60000} minutes of voice inactivity
• Mute/deafen status is ignored - only voice activity matters
• Protected channels: ${AFK_EXCLUDED_CHANNELS.join(', ')}
• Perfect for catching people who fall asleep in voice

**🎯 Features:**
• Dynamic voice channel creation
• Auto-synced category permissions
• Voice time tracking with PostgreSQL
• Captain permissions for channel creators
• Automatic cleanup of empty channels
• AFK user management with One Piece themes`);
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
        activeConnections.forEach((connection, channelId) => {
            try {
                connection.destroy();
                debugLog(`🔌 Destroyed connection for channel ${channelId}`);
            } catch (error) {
                console.error(`❌ Error destroying connection ${channelId}:`, error);
            }
        });
        activeConnections.clear();
        
        // Clear AFK tracking
        log(`😴 Clearing ${afkUsers.size} AFK tracking sessions...`);
        afkUsers.clear();
        
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
        console.log(`🏴‍☠️ Bot Status - Guilds: ${client.guilds.cache.size}, Active Voice Sessions: ${voiceSessions.size}, AFK Tracked: ${afkUsers.size}, Audio Connections: ${activeConnections.size}, Uptime: ${Math.floor(process.uptime()/60)}m`);
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
