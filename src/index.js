const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const VoiceTimeTracker = require('./voiceTimeTracker');
const { registerSlashCommands } = require('./slashCommands');

// Load environment variables
require('dotenv').config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CREATE_CHANNEL_NAME = process.env.CREATE_CHANNEL_NAME || '🏴〢Set Sail Together';
const DEFAULT_CATEGORY_NAME = process.env.CATEGORY_NAME || '✘ SOCIAL ✘';
const CATEGORY_ID = process.env.CATEGORY_ID; // Direct category ID override
const DELETE_DELAY = parseInt(process.env.DELETE_DELAY) || 1000;
const DEBUG = process.env.DEBUG === 'true';

// Audio Configuration
const AUDIO_VOLUME = parseFloat(process.env.AUDIO_VOLUME) || 0.4;

// PostgreSQL connection with Railway support
let pool;
let voiceTimeTracker;

async function initializeConnection() {
    // Railway PostgreSQL connection
    if (process.env.DATABASE_URL) {
        // Direct connection with DATABASE_URL (Railway style)
        log('🚂 Connecting to Railway PostgreSQL...');
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
    } else {
        // Manual connection (fallback)
        const config = {
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            host: process.env.PGHOST,
            port: process.env.PGPORT || 5432,
            database: process.env.PGDATABASE,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        };
        
        if (!config.user || !config.password || !config.host || !config.database) {
            throw new Error('DATABASE_URL or individual PostgreSQL environment variables are required');
        }
        
        log('🗄️ Connecting to PostgreSQL with manual config...');
        pool = new Pool(config);
    }
    
    // Test the connection
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        log(`✅ PostgreSQL connected successfully at ${result.rows[0].now}`);
        client.release();
    } catch (error) {
        log(`❌ PostgreSQL connection failed: ${error.message}`);
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

// Track audio connections and prevent duplicate channel creation
const activeConnections = new Map(); // channelId -> voice connection
const recentCreations = new Set(); // userId -> prevent rapid channel creation
const userOwnedChannels = new Map(); // userId -> channelId (track who owns which channel)
const processingUsers = new Set(); // ATOMIC: users currently being processed

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

// Database functions for guild settings
async function initializeDatabase() {
    try {
        // Create guild_settings table (keep this for category management)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id VARCHAR(255) PRIMARY KEY,
                category_id VARCHAR(255) NOT NULL,
                category_name VARCHAR(255) NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
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

// Function to play welcome sound in a voice channel
async function playWelcomeSound(channel) {
    try {
        // SAFETY CHECK: Never join the "Set Sail Together" channel
        if (channel.name === CREATE_CHANNEL_NAME) {
            console.error(`🚨 SAFETY: Bot attempted to join create channel "${CREATE_CHANNEL_NAME}" - BLOCKED!`);
            return;
        }
        
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
        }, 5000);

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
        
        // Initialize voice time tracker (this will wipe old tables)
        voiceTimeTracker = new VoiceTimeTracker(client, pool);
        log(`⏱️ Voice Time Tracker initialized (database wiped and recreated)`);
        
        // Register slash commands
        if (CLIENT_ID) {
            await registerSlashCommands(CLIENT_ID, DISCORD_TOKEN);
        }
        
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
                            const username = member.displayName;
                            const guildId = guild.id;
                            const channelId = channel.id;
                            const channelName = channel.name;
                            
                            // Start tracking existing users
                            voiceTimeTracker.startSession(userId, username, guildId, channelId, channelName);
                            
                            log(`🔄 Now tracking existing user: ${username} in ${channelName}`);
                        }
                    });
                });
        });

        // Add debug logging for voice logging status
        if (process.env.ENABLE_VOICE_LOGGING === 'true') {
            log(`🔍 Voice channel logging is ENABLED`);
            if (process.env.VOICE_LOG_CHANNEL_ID) {
                log(`📝 Target log channel ID: ${process.env.VOICE_LOG_CHANNEL_ID}`);
            } else {
                log(`📝 Target log channel name: ${process.env.VOICE_LOG_CHANNEL || 'voice-activity-log'}`);
            }
        } else {
            log(`⚠️ Voice channel logging is DISABLED`);
        }
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        console.error('❌ Bot will shut down due to database error');
        process.exit(1);
    }
});

// Voice state update handler with detailed debugging
client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id || oldState.id;
    const member = newState.member || oldState.member;
    const guildId = (newState.guild || oldState.guild).id;
    
    // Log EVERY voice state change for debugging
    console.log(`🔍 RAW EVENT: ${member.displayName} | Old: ${oldState.channelId ? oldState.channel.name : 'none'} | New: ${newState.channelId ? newState.channel.name : 'none'} | Bot: ${member.user.bot}`);

    // Skip bot events (but still log them above)
    if (member.user.bot) {
        return;
    }

    try {
        // Handle voice time tracking
        if (voiceTimeTracker) {
            await voiceTimeTracker.handleVoiceStateUpdate(oldState, newState);
        }

        // SIMPLE: User joined the create channel
        if (!oldState.channelId && newState.channelId && newState.channel?.name === CREATE_CHANNEL_NAME) {
            console.log(`🎯 USER JOINED CREATE CHANNEL: ${member.displayName} joined ${CREATE_CHANNEL_NAME}`);
            
            // ATOMIC LOCK: Prevent parallel processing of same user
            if (processingUsers.has(userId)) {
                console.log(`🔒 ATOMIC BLOCK: ${member.displayName} is already being processed, ignoring`);
                return;
            }
            
            // Lock this user immediately
            processingUsers.add(userId);
            console.log(`🔒 ATOMIC LOCK: ${member.displayName} locked for processing`);
            
            try {
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
                        // Make sure to join the NEW channel, not the create channel
                        playWelcomeSound(newChannel);
                    }, 1500);
                    
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

        // Auto-delete empty dynamic channels with safe deletion
        if (oldState.channelId && !newState.channelId) {
            const oldChannel = oldState.channel;
            const savedCategory = await getCategoryForGuild(guildId);
            const categoryName = savedCategory ? savedCategory.categoryName : DEFAULT_CATEGORY_NAME;
            
            if (oldChannel && 
                oldChannel.name !== CREATE_CHANNEL_NAME && 
                oldChannel.parent?.name === categoryName &&
                oldChannel.members.size === 0) {
                
                console.log(`🕐 SCHEDULING DELETION: ${oldChannel.name} in ${DELETE_DELAY}ms`);
                
                // Clean up any voice connections for this channel
                if (activeConnections.has(oldChannel.id)) {
                    const connection = activeConnections.get(oldChannel.id);
                    connection.destroy();
                    activeConnections.delete(oldChannel.id);
                    console.log(`🔌 CLEANED CONNECTION: for ${oldChannel.name}`);
                }
                
                setTimeout(async () => {
                    try {
                        // SAFE DELETION: Check if channel still exists
                        const channelToDelete = await oldChannel.guild.channels.fetch(oldChannel.id).catch(() => null);
                        if (channelToDelete && channelToDelete.members.size === 0) {
                            await channelToDelete.delete();
                            console.log(`🗑️ SAFELY DELETED: ${oldChannel.name}`);
                            
                            // Clean up ownership tracking
                            for (const [userId, channelId] of userOwnedChannels.entries()) {
                                if (channelId === oldChannel.id) {
                                    userOwnedChannels.delete(userId);
                                    console.log(`🧹 CLEANED OWNERSHIP: for ${oldChannel.name}`);
                                }
                            }
                        } else if (!channelToDelete) {
                            console.log(`⚠️ ALREADY DELETED: ${oldChannel.name} was already deleted`);
                        } else {
                            console.log(`👥 NOT EMPTY: ${oldChannel.name} has ${channelToDelete.members.size} members, keeping it`);
                        }
                    } catch (error) {
                        if (error.code === 10003) {
                            console.log(`⚠️ ALREADY DELETED: ${oldChannel.name} (Unknown Channel)`);
                        } else {
                            console.error(`❌ Error deleting channel ${oldChannel.name}:`, error.message);
                        }
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

// Slash command handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'check-voice-time') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const voiceData = await voiceTimeTracker.getUserVoiceTime(targetUser.id, interaction.guild.id);
            
            if (!voiceData || voiceData.total_seconds === 0) {
                await interaction.reply({
                    content: `📊 ${targetUser.displayName} has no recorded voice time in this server.`,
                    ephemeral: true
                });
                return;
            }

            const formattedTime = voiceTimeTracker.formatTime(voiceData.total_seconds);
            const lastActive = new Date(voiceData.last_updated).toLocaleDateString();

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🎤 Voice Time Statistics')
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: '👤 User', value: targetUser.displayName, inline: true },
                    { name: '⏱️ Total Voice Time', value: formattedTime, inline: true },
                    { name: '📅 Last Active', value: lastActive, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'One Piece Voice Bot' });

            await interaction.reply({ embeds: [embed] });
        }

        else if (commandName === 'voice-leaderboard') {
            const limit = interaction.options.getInteger('limit') || 10;
            const topUsers = await voiceTimeTracker.getTopVoiceUsers(interaction.guild.id, limit);

            if (topUsers.length === 0) {
                await interaction.reply({
                    content: '📊 No voice time data found for this server.',
                    ephemeral: true
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Voice Time Leaderboard')
                .setDescription(`Top ${topUsers.length} voice users in ${interaction.guild.name}`)
                .setTimestamp()
                .setFooter({ text: 'One Piece Voice Bot' });

            let description = '';
            topUsers.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                const formattedTime = voiceTimeTracker.formatTime(user.total_seconds);
                description += `${medal} **${user.username}** - ${formattedTime}\n`;
            });

            embed.addFields({ name: '🎤 Rankings', value: description });

            await interaction.reply({ embeds: [embed] });
        }

        else if (commandName === 'bot-info') {
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);

            const embed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('🏴‍☠️ One Piece Voice Bot Info')
                .addFields(
                    { name: '⚓ Servers', value: `${client.guilds.cache.size}`, inline: true },
                    { name: '👤 Active Voice Sessions', value: `${voiceTimeTracker.getActiveSessionsCount()}`, inline: true },
                    { name: '🎵 Audio Connections', value: `${activeConnections.size}`, inline: true },
                    { name: '⏰ Uptime', value: `${hours}h ${minutes}m`, inline: true },
                    { name: '🗄️ Database', value: 'Connected', inline: true },
                    { name: '🎤 Features', value: 'Dynamic Channels, Voice Tracking, Welcome Sounds', inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'One Piece Voice Bot' });

            await interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('❌ Error handling slash command:', error);
        if (!interaction.replied) {
            await interaction.reply({
                content: '❌ An error occurred while processing this command.',
                ephemeral: true
            });
        }
    }
});

// Legacy message commands and testing commands
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Voice stats command (legacy)
    if (message.content === '!voicestats' || message.content === '!stats') {
        try {
            const voiceData = await voiceTimeTracker.getUserVoiceTime(message.author.id, message.guild.id);
            if (voiceData && voiceData.total_seconds > 0) {
                const formattedTime = voiceTimeTracker.formatTime(voiceData.total_seconds);
                message.reply(`📊 **${message.author.displayName}'s Voice Time**\n⏱️ **Total:** ${formattedTime}\n💡 Use \`/check-voice-time\` for better formatting!`);
            } else {
                message.reply('📊 No voice time recorded! Join some voice channels to start tracking! 🎤');
            }
        } catch (error) {
            console.error('❌ Error getting voice stats:', error);
            message.reply('❌ Error retrieving voice stats. Please try again later.');
        }
    }

    // Debug creation locks command
    if (message.content === '!locks') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission!');
        }
        
        const lockCount = recentCreations.size;
        const connectionCount = activeConnections.size;
        const lockedUsers = Array.from(recentCreations).map(id => {
            const member = message.guild.members.cache.get(id);
            return member ? member.displayName : id;
        }).join(', ');
        
        message.reply(`🔒 **Debug Status:**
**Creation Locks:** ${lockCount} ${lockedUsers ? `(${lockedUsers})` : ''}
**Active Connections:** ${connectionCount}
**Active Voice Sessions:** ${voiceTimeTracker ? voiceTimeTracker.getActiveSessionsCount() : 0}`);
    }

    // Clear locks command (emergency)
    if (message.content === '!clearlocks') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        
        const lockCount = recentCreations.size;
        recentCreations.clear();
        
        message.reply(`🧹 **Cleared debug state:**
**Removed ${lockCount} creation locks**
**✅ Bot state reset**`);
    }
    if (message.content === '!testlog') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission to test logging!');
        }

        try {
            // Test if the channel exists
            const channelId = process.env.VOICE_LOG_CHANNEL_ID;
            if (!channelId) {
                return message.reply('❌ VOICE_LOG_CHANNEL_ID not set in environment variables!');
            }

            const testChannel = message.guild.channels.cache.get(channelId);
            if (!testChannel) {
                return message.reply(`❌ Channel with ID ${channelId} not found in this server!`);
            }

            // Test sending a message
            await testChannel.send('🧪 **Test Message** - Voice logging should work if you can see this!');
            
            // Test sending an embed (like the voice logs)
            const testEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🧪 Test Voice Log')
                .setDescription(`<@${message.author.id}> joined <#${message.channel.id}>`)
                .addFields(
                    { name: '👤 User', value: message.author.displayName, inline: true },
                    { name: '🏠 Channel', value: 'Test Channel', inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Voice Activity Logger - TEST' });

            await testChannel.send({ embeds: [testEmbed] });
            
            message.reply(`✅ Test successful! Check ${testChannel} for test messages.`);
        } catch (error) {
            message.reply(`❌ Error testing channel: ${error.message}`);
            console.error('Test log error:', error);
        }
    }

    // Debug voice logging status
    if (message.content === '!debuglog') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission!');
        }

        const status = `🔍 **Voice Logging Debug Info:**
**Enabled:** ${process.env.ENABLE_VOICE_LOGGING}
**Channel ID:** ${process.env.VOICE_LOG_CHANNEL_ID || 'Not set'}
**Channel Name Fallback:** ${process.env.VOICE_LOG_CHANNEL || 'voice-activity-log'}
**Voice Tracker Active:** ${voiceTimeTracker ? 'Yes' : 'No'}
**Active Sessions:** ${voiceTimeTracker ? voiceTimeTracker.getActiveSessionsCount() : 0}`;

        message.reply(status);
    }

    // Force test voice event
    if (message.content === '!forcelog') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission!');
        }

        try {
            // Manually trigger a voice log event
            await voiceTimeTracker.channelLogger.logVoiceEvent(
                message.guild.id,
                message.author.id,
                message.author.displayName,
                message.channel.id,
                message.channel.name,
                'JOIN',
                {}
            );
            message.reply('🧪 Forced voice log event sent!');
        } catch (error) {
            message.reply(`❌ Error: ${error.message}`);
            console.error('Force log error:', error);
        }
    }

    // Command to create voice log channel
    if (message.content === '!createvoicelog') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission to create the voice log channel!');
        }

        try {
            const newChannel = await voiceTimeTracker.createLogChannel(message.guild);
            if (newChannel) {
                message.reply(`✅ Created voice log channel: ${newChannel}\n🔍 Voice activity will now be logged here!`);
            } else {
                message.reply('❌ Error creating voice log channel. Please check bot permissions.');
            }
        } catch (error) {
            console.error('❌ Error creating voice log channel:', error);
            message.reply('❌ Error creating voice log channel. Please check bot permissions.');
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
    
    // Test sound command
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
\`/check-voice-time [@user]\` - Check voice time for a user (NEW!)
\`/voice-leaderboard [limit]\` - Show top voice users (NEW!)
\`/bot-info\` - Show bot information (NEW!)
\`!voicestats\` - Legacy voice stats command
\`!ping\` - Check bot latency

**🎵 Audio Testing:**
\`!testsound\` - Test welcome sound in your current voice channel
\`!checksound\` - Check if sound file exists and show details

**🔧 Debug Commands:**
\`!testlog\` - Test voice logging channel (Manage Channels required)
\`!debuglog\` - Show voice logging debug info (Manage Channels required)
\`!forcelog\` - Force send a test voice event (Manage Channels required)
\`!createvoicelog\` - Create voice log channel (Manage Channels required)

**🚢 How to Use:**
1. Join "${CREATE_CHANNEL_NAME}" voice channel
2. Bot will create a new crew with a One Piece themed name
3. You become the captain with full channel permissions
4. Bot plays welcome sound (if file exists)
5. Empty crews are automatically deleted after ${DELETE_DELAY/1000} seconds
6. Voice time is automatically tracked!

**🎯 Features:**
• Dynamic voice channel creation with One Piece themed names
• **Simplified voice time tracking (total time only)**
• **Real-time Discord channel logging of voice events**
• Captain permissions for channel creators
• Automatic cleanup of empty channels
• Welcome sounds with The Going Merry theme
• **Slash commands for better user experience**

**💡 Use slash commands (/) for the best experience!**
**🔍 Voice events are logged to your designated channel with rich embeds!**`);
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
        if (voiceTimeTracker) {
            await voiceTimeTracker.endAllSessions();
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
        const activeSessions = voiceTimeTracker ? voiceTimeTracker.getActiveSessionsCount() : 0;
        console.log(`🏴‍☠️ Bot Status - Guilds: ${client.guilds.cache.size}, Active Voice Sessions: ${activeSessions}, Audio Connections: ${activeConnections.size}, Uptime: ${Math.floor(process.uptime()/60)}m`);
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

    if (!CLIENT_ID) {
        console.error('❌ CLIENT_ID is required for slash commands! Please check your .env file.');
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
