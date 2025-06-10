const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');

// Load environment variables only in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Configuration from environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CREATE_CHANNEL_NAME = process.env.CREATE_CHANNEL_NAME || '🏴 Set Sail Together';
const CATEGORY_NAME = process.env.CATEGORY_NAME || '🌊 Grand Line Voice Channels';
const DELETE_DELAY = parseInt(process.env.DELETE_DELAY) || 5000;
const AUDIO_VOLUME = parseFloat(process.env.AUDIO_VOLUME) || 0.4;

// AFK Management Settings (from Railway variables)
const AFK_TIMEOUT = parseInt(process.env.AFK_TIMEOUT) || 900000; // Default 15 minutes
const AFK_EXCLUDED_CHANNELS = process.env.AFK_EXCLUDED_CHANNELS 
    ? process.env.AFK_EXCLUDED_CHANNELS.split(',').map(ch => ch.trim()) 
    : ['Lofi/Chill']; // Default fallback

const DEBUG = process.env.DEBUG === 'true';

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
        GatewayIntentBits.GuildMessages
    ]
});

// Track users and their AFK timers
const userTimers = new Map();
const trackedUsers = new Map();
const activeConnections = new Map();

// Sound file path
const SOUND_FILE = path.join(__dirname, '..', 'sounds', 'The Going Merry One Piece - Cut.ogg');

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

function isProtectedChannel(channelName) {
    return AFK_EXCLUDED_CHANNELS.some(protected => 
        channelName.toLowerCase().includes(protected.toLowerCase())
    );
}

function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes > 0) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''}${seconds > 0 ? ` ${seconds} second${seconds !== 1 ? 's' : ''}` : ''}`;
    }
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

// AFK Management Functions
function startAFKTimer(userId, channelId, channelName) {
    // Don't start timer for protected channels
    if (isProtectedChannel(channelName)) {
        debugLog(`Skipping AFK timer for protected channel: ${channelName}`);
        return;
    }

    // Clear existing timer if any
    clearAFKTimer(userId);

    debugLog(`Starting AFK timer for user ${userId} in ${channelName} (${formatTime(AFK_TIMEOUT)})`);

    const timer = setTimeout(async () => {
        try {
            const guild = client.guilds.cache.find(g => g.channels.cache.has(channelId));
            if (!guild) return;

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member || !member.voice.channelId) {
                debugLog(`User ${userId} no longer in voice channel`);
                return;
            }

            // Double-check they're still in a non-protected channel
            const currentChannel = guild.channels.cache.get(member.voice.channelId);
            if (!currentChannel || isProtectedChannel(currentChannel.name)) {
                debugLog(`User ${userId} is now in protected channel: ${currentChannel?.name}`);
                return;
            }

            // Disconnect the user
            try {
                await member.voice.disconnect('AFK timeout - inactive for too long');
                log(`⏰ Disconnected ${member.displayName} for being AFK (${formatTime(AFK_TIMEOUT)} timeout)`);

                // Send a friendly message
                try {
                    await member.send(`🏴‍☠️ Ahoy! You were disconnected from **${currentChannel.name}** for being inactive for ${formatTime(AFK_TIMEOUT)}. The seas await your return, nakama! 🌊`);
                } catch (dmError) {
                    debugLog(`Could not send DM to ${member.displayName}: ${dmError.message}`);
                }
            } catch (disconnectError) {
                // User might have already disconnected
                if (disconnectError.code === 40032) {
                    debugLog(`User ${member.displayName} already disconnected`);
                } else {
                    console.error(`❌ Error disconnecting user ${userId}:`, disconnectError);
                }
            }

        } catch (error) {
            console.error(`❌ Error handling AFK timeout for user ${userId}:`, error);
        } finally {
            userTimers.delete(userId);
            trackedUsers.delete(userId);
        }
    }, AFK_TIMEOUT);

    userTimers.set(userId, timer);
    trackedUsers.set(userId, { channelId, channelName, startTime: Date.now() });
}

function clearAFKTimer(userId) {
    const timer = userTimers.get(userId);
    if (timer) {
        clearTimeout(timer);
        userTimers.delete(userId);
        debugLog(`Cleared AFK timer for user ${userId}`);
    }
}

function resetAFKTimer(userId, channelId, channelName) {
    if (trackedUsers.has(userId)) {
        debugLog(`Resetting AFK timer for user ${userId} in ${channelName}`);
        clearAFKTimer(userId);
        startAFKTimer(userId, channelId, channelName);
    }
}

// Sound playing function
async function playWelcomeSound(channel) {
    try {
        // Check if sound file exists
        if (!fs.existsSync(SOUND_FILE)) {
            debugLog(`Sound file not found: ${SOUND_FILE}`);
            return;
        }

        debugLog(`Playing welcome sound in ${channel.name}`);

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        activeConnections.set(channel.id, connection);

        const player = createAudioPlayer();
        const resource = createAudioResource(SOUND_FILE, { 
            inlineVolume: true 
        });
        
        resource.volume.setVolume(AUDIO_VOLUME);

        player.play(resource);
        connection.subscribe(player);

        // Handle player events
        player.on(AudioPlayerStatus.Playing, () => {
            debugLog(`🎵 Now playing welcome sound in ${channel.name}`);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            debugLog(`🎵 Finished playing welcome sound in ${channel.name}`);
            // Disconnect after playing
            setTimeout(() => {
                if (activeConnections.has(channel.id)) {
                    connection.destroy();
                    activeConnections.delete(channel.id);
                }
            }, 1000);
        });

        player.on('error', error => {
            console.error(`❌ Audio player error in ${channel.name}:`, error);
            if (activeConnections.has(channel.id)) {
                connection.destroy();
                activeConnections.delete(channel.id);
            }
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            debugLog(`🔌 Disconnected from ${channel.name}`);
            activeConnections.delete(channel.id);
        });

    } catch (error) {
        console.error(`❌ Error playing welcome sound:`, error);
    }
}

// Bot event handlers
client.once('ready', () => {
    log(`One Piece Voice Bot is ready to set sail!`);
    log(`⚓ Logged in as ${client.user.tag}`);
    log(`🏴‍☠️ AFK Manager: Started monitoring for inactive pirates...`);
    log(`⏰ AFK Timeout: ${formatTime(AFK_TIMEOUT)}`);
    log(`🛡️ Protected Channels: ${AFK_EXCLUDED_CHANNELS.join(', ')}`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id;
    const member = newState.member;

    try {
        // Handle user leaving voice
        if (oldState.channelId && !newState.channelId) {
            clearAFKTimer(userId);
            trackedUsers.delete(userId);
            debugLog(`👋 Stopped tracking user ${userId}`);
        }

        // Handle user joining voice
        if (!oldState.channelId && newState.channelId) {
            const channel = newState.channel;
            if (channel && channel.name !== CREATE_CHANNEL_NAME) {
                startAFKTimer(userId, channel.id, channel.name);
                debugLog(`👁️ Now tracking user ${userId} in channel ${channel.id} (AFK: ${!isProtectedChannel(channel.name)})`);
            }
        }

        // Handle user switching channels
        if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            const newChannel = newState.channel;
            if (newChannel && newChannel.name !== CREATE_CHANNEL_NAME) {
                startAFKTimer(userId, newChannel.id, newChannel.name);
                debugLog(`👁️ Now tracking user ${userId} in channel ${newChannel.id} (AFK: ${!isProtectedChannel(newChannel.name)})`);
            } else {
                clearAFKTimer(userId);
                trackedUsers.delete(userId);
            }
        }

        // Dynamic Voice Channel Creation
        if (newState.channelId && newState.channel?.name === CREATE_CHANNEL_NAME) {
            const guild = newState.guild;
            
            // Additional check to make sure user is still connected
            if (!member.voice.channelId) {
                debugLog(`User ${member.displayName} no longer in voice, skipping channel creation`);
                return;
            }
            
            // Find or create category - look for exact match first
            let category = guild.channels.cache.find(c => 
                c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory
            );
            
            if (!category) {
                debugLog(`Category "${CATEGORY_NAME}" not found, creating it...`);
                category = await guild.channels.create({
                    name: CATEGORY_NAME,
                    type: ChannelType.GuildCategory,
                });
                log(`📁 Created category: ${CATEGORY_NAME}`);
            } else {
                debugLog(`Found existing category: ${category.name} (ID: ${category.id})`);
            }

            // Create new crew channel
            const crewName = getRandomCrewName();
            const newChannel = await guild.channels.create({
                name: crewName,
                type: ChannelType.GuildVoice,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: member.id,
                        allow: [
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.MoveMembers,
                            PermissionFlagsBits.MuteMembers,
                            PermissionFlagsBits.DeafenMembers
                        ]
                    }
                ]
            });

            log(`🚢 Created new crew: ${crewName} for ${member.displayName} in category ${category.name}`);

            // Move user to new channel with error handling
            try {
                // Check if user is still connected to voice
                if (member.voice.channelId) {
                    await member.voice.setChannel(newChannel);
                    
                    // Play welcome sound after successful move
                    setTimeout(() => {
                        playWelcomeSound(newChannel);
                    }, 1000); // Small delay to ensure user is properly connected

                    // Start AFK tracking for the new channel
                    startAFKTimer(userId, newChannel.id, crewName);
                } else {
                    // User disconnected before we could move them, clean up the channel
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
                // Clean up the channel if move failed
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
            if (oldChannel && 
                oldChannel.name !== CREATE_CHANNEL_NAME && 
                oldChannel.parent?.name === CATEGORY_NAME &&
                oldChannel.members.size === 0) {
                
                // Clean up any active voice connection
                if (activeConnections.has(oldChannel.id)) {
                    const connection = activeConnections.get(oldChannel.id);
                    connection.destroy();
                    activeConnections.delete(oldChannel.id);
                }
                
                setTimeout(async () => {
                    try {
                        // Double-check it's still empty
                        const channelToDelete = guild.channels.cache.get(oldChannel.id);
                        if (channelToDelete && channelToDelete.members.size === 0) {
                            await channelToDelete.delete();
                            debugLog(`🗑️ Deleted empty crew: ${oldChannel.name}`);
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

// Handle speaking events to reset AFK timers
client.on('voiceStateUpdate', (oldState, newState) => {
    // Reset AFK timer when user starts/stops speaking, mutes/unmutes, etc.
    const userId = newState.id;
    if (newState.channelId && trackedUsers.has(userId)) {
        const channelData = trackedUsers.get(userId);
        if (channelData && !isProtectedChannel(channelData.channelName)) {
            // Only reset if it's been more than 30 seconds since last reset to avoid spam
            const timeSinceStart = Date.now() - channelData.startTime;
            if (timeSinceStart > 30000) { // 30 seconds
                resetAFKTimer(userId, newState.channelId, channelData.channelName);
            }
        }
    }
});

// Error handling
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
    log('🛑 Shutting down bot...');
    
    // Clear all timers
    userTimers.forEach(timer => clearTimeout(timer));
    userTimers.clear();
    trackedUsers.clear();
    
    // Clean up voice connections
    activeConnections.forEach(connection => connection.destroy());
    activeConnections.clear();
    
    client.destroy();
    process.exit(0);
});

// Start the bot
client.login(DISCORD_TOKEN).catch(error => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
});
