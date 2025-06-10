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

// Track active voice connections for cleanup
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
    log(`🏴‍☠️ AFK Management: DISABLED (use AFKManager.js if needed)`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id;
    const member = newState.member;

    try {
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

            // Force move to category if it didn't work
            if (newChannel.parentId !== category.id) {
                try {
                    await newChannel.setParent(category.id);
                    debugLog(`🔧 Manually moved ${crewName} to category ${category.name}`);
                } catch (moveError) {
                    console.error(`❌ Error moving channel to category:`, moveError);
                }
            }

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
                        const channelToDelete = oldChannel.guild.channels.cache.get(oldChannel.id);
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

// Error handling
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
    log('🛑 Shutting down bot...');
    
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
