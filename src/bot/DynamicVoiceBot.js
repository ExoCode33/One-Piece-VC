const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Enable debug logging
const DEBUG = process.env.DEBUG === 'true';

function debugLog(message) {
    if (DEBUG) {
        console.log(`🔍 DEBUG: ${message}`);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// One Piece themed channel names
const onePieceLocations = [
    "🏴‍☠️ Going Merry Crew",
    "⚓ Thousand Sunny Squad",
    "🏝️ Water 7 Workshop",
    "🌊 Enies Lobby Expedition",
    "🏴‍☠️ Alabasta Adventure"
];

// Store active connections
const voiceConnections = new Map();
const audioPlayers = new Map();

// Audio file path
const audioFilePath = path.join(__dirname, '..', 'sounds', 'The Going Merry One Piece - Cut.ogg');

client.once('ready', () => {
    console.log(`🏴‍☠️ ${client.user.tag} is ready to sail the Grand Line!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Check environment variables
    console.log(`📝 CREATE_CHANNEL_NAME: "${process.env.CREATE_CHANNEL_NAME || '🏴‍☠️ Set Sail Together'}"`);
    console.log(`📂 CATEGORY_NAME: "${process.env.CATEGORY_NAME || '🌊 Grand Line Voice Channels'}"`);
    
    // Verify audio file exists
    console.log(`🎵 Checking audio file at: ${audioFilePath}`);
    if (!fs.existsSync(audioFilePath)) {
        console.error('❌ Audio file not found!');
        console.log('Expected location:', audioFilePath);
        console.log('Make sure the file exists and is named exactly: "The Going Merry One Piece - Cut.ogg"');
    } else {
        const stats = fs.statSync(audioFilePath);
        console.log(`✅ Audio file found! Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }
    
    // List all channels in all guilds (for debugging)
    debugLog('Scanning all channels...');
    client.guilds.cache.forEach(guild => {
        debugLog(`Guild: ${guild.name}`);
        guild.channels.cache.forEach(channel => {
            if (channel.type === ChannelType.GuildVoice) {
                debugLog(`  Voice Channel: "${channel.name}"`);
            }
        });
    });
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    const createChannelName = process.env.CREATE_CHANNEL_NAME || '🏴‍☠️ Set Sail Together';
    const categoryName = process.env.CATEGORY_NAME || '🌊 Grand Line Voice Channels';
    const deleteDelay = parseInt(process.env.DELETE_DELAY) || 5000;

    // Debug logging
    console.log('\n🔄 Voice State Update Detected:');
    console.log(`User: ${newState.member?.displayName || 'Unknown'}`);
    console.log(`Old Channel: ${oldState.channel?.name || 'None'}`);
    console.log(`New Channel: ${newState.channel?.name || 'None'}`);
    console.log(`Looking for channel named: "${createChannelName}"`);

    // User joined a channel
    if (newState.channel) {
        console.log(`✅ User joined: "${newState.channel.name}"`);
        console.log(`🔍 Checking if "${newState.channel.name}" === "${createChannelName}"`);
        
        if (newState.channel.name === createChannelName) {
            console.log('🎯 MATCH! User joined the create channel!');
            
            try {
                const guild = newState.guild;
                const member = newState.member;
                
                console.log(`🏴‍☠️ Creating new crew for ${member.displayName}...`);
                
                // Check if user is in a category and use that, otherwise find/create our category
                let category;
                const userCurrentCategory = newState.channel.parent;
                
                if (userCurrentCategory) {
                    console.log(`📂 User is in category: "${userCurrentCategory.name}"`);
                    console.log(`🤔 Should we use this category or create our own?`);
                    
                    // Use the same category as the trigger channel
                    category = userCurrentCategory;
                    console.log(`✅ Using existing category: "${category.name}"`);
                } else {
                    // Find or create our category
                    category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
                    if (!category) {
                        console.log(`📁 Creating category: ${categoryName}`);
                        category = await guild.channels.create({
                            name: categoryName,
                            type: ChannelType.GuildCategory,
                        });
                    } else {
                        console.log(`📁 Found existing category: ${categoryName}`);
                    }
                }

                // Create new voice channel
                const randomName = onePieceLocations[Math.floor(Math.random() * onePieceLocations.length)];
                console.log(`🚢 Creating channel: ${randomName} in category: ${category.name}`);
                
                const newChannel = await guild.channels.create({
                    name: randomName,
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

                console.log(`✅ Channel created successfully: ${newChannel.name}`);

                // Move user to new channel
                console.log(`🔄 Moving ${member.displayName} to new channel...`);
                await member.voice.setChannel(newChannel);
                console.log(`✅ User moved successfully!`);

                // Play audio
                console.log(`🎵 Starting audio playback...`);
                await playAudio(newChannel, member);

            } catch (error) {
                console.error('❌ Error in voice state update:', error);
            }
        } else {
            console.log('❌ Channel name does not match. No action taken.');
        }
    }

    // Handle channel cleanup
    if (oldState.channel && 
        oldState.channel.parent && 
        oldState.channel.parent.name === categoryName &&
        oldState.channel.name !== createChannelName) {
        
        console.log(`🧹 Checking if ${oldState.channel.name} needs cleanup...`);
        
        if (oldState.channel.members.size === 0) {
            console.log(`⏰ Empty channel detected. Scheduling cleanup in ${deleteDelay}ms...`);
            
            setTimeout(async () => {
                try {
                    if (oldState.channel.members.size === 0) {
                        const connectionKey = `${oldState.channel.guild.id}-${oldState.channel.id}`;
                        
                        // Clean up voice connection
                        if (voiceConnections.has(connectionKey)) {
                            console.log(`🔌 Cleaning up voice connection...`);
                            const connection = voiceConnections.get(connectionKey);
                            connection.destroy();
                            voiceConnections.delete(connectionKey);
                        }
                        
                        // Clean up audio player
                        if (audioPlayers.has(connectionKey)) {
                            console.log(`🎵 Stopping audio player...`);
                            const player = audioPlayers.get(connectionKey);
                            player.stop();
                            audioPlayers.delete(connectionKey);
                        }

                        await oldState.channel.delete();
                        console.log(`🗑️ Deleted empty crew: ${oldState.channel.name}`);
                    } else {
                        console.log(`👥 Channel no longer empty, keeping it.`);
                    }
                } catch (error) {
                    console.error('❌ Error during cleanup:', error);
                }
            }, deleteDelay);
        }
    }
});

// Manual cleanup command
client.on('messageCreate', async (message) => {
    if (message.content === '!forceLeave' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        console.log('🧹 Force leave command received');
        
        voiceConnections.forEach((connection, key) => {
            console.log(`🔌 Force destroying connection: ${key}`);
            try {
                connection.destroy();
                voiceConnections.delete(key);
            } catch (err) {
                console.log(`Error destroying connection ${key}:`, err.message);
            }
        });
        
        audioPlayers.forEach((player, key) => {
            console.log(`🎵 Force stopping player: ${key}`);
            try {
                player.stop();
                audioPlayers.delete(key);
            } catch (err) {
                console.log(`Error stopping player ${key}:`, err.message);
            }
        });
        
        message.reply('🧹 Bot forced to leave all voice channels!');
    }
});

async function playAudio(channel, member) {
    const channelName = channel.name; // Store channel name as string to avoid null reference errors
    const channelId = channel.id;
    const guildId = channel.guild.id;
    
    console.log(`🎵 playAudio() called for channel: ${channelName}`);
    
    try {
        // Check if audio file exists
        if (!fs.existsSync(audioFilePath)) {
            console.error('❌ Audio file not found, cannot play audio');
            return;
        }

        console.log(`🔌 Joining voice channel: ${channelName}`);

        // Create voice connection
        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        // Store connection
        const connectionKey = `${guildId}-${channelId}`;
        voiceConnections.set(connectionKey, connection);
        console.log(`💾 Stored voice connection with key: ${connectionKey}`);

        // Create a cleanup function to avoid duplication
        const cleanupConnection = (reason = 'unknown') => {
            console.log(`🧹 Cleaning up connection for ${channelName} (reason: ${reason})`);
            console.log(`🔍 Before cleanup - Connection exists: ${voiceConnections.has(connectionKey)}`);
            console.log(`🔍 Before cleanup - Player exists: ${audioPlayers.has(connectionKey)}`);
            
            try {
                // Stop audio player first
                if (audioPlayers.has(connectionKey)) {
                    const player = audioPlayers.get(connectionKey);
                    console.log(`🎵 Stopping audio player...`);
                    player.stop();
                    audioPlayers.delete(connectionKey);
                    console.log(`🎵 Audio player stopped and removed`);
                } else {
                    console.log(`🎵 No audio player to clean up`);
                }

                // Destroy voice connection
                if (voiceConnections.has(connectionKey)) {
                    const conn = voiceConnections.get(connectionKey);
                    console.log(`🔌 Connection status: ${conn.state.status}`);
                    
                    if (conn.state.status !== VoiceConnectionStatus.Destroyed) {
                        console.log(`🔌 Destroying voice connection...`);
                        conn.destroy();
                        console.log(`🔌 Voice connection destroyed`);
                    } else {
                        console.log(`🔌 Connection already destroyed`);
                    }
                    voiceConnections.delete(connectionKey);
                    console.log(`🔌 Connection removed from map`);
                } else {
                    console.log(`🔌 No voice connection to clean up`);
                }
                
                console.log(`✅ Cleanup completed for ${channelName}`);
                console.log(`🔍 After cleanup - Connection exists: ${voiceConnections.has(connectionKey)}`);
                console.log(`🔍 After cleanup - Player exists: ${audioPlayers.has(connectionKey)}`);
            } catch (error) {
                console.error('❌ Error during cleanup:', error);
                console.error('❌ Stack trace:', error.stack);
            }
        };

        // Set up the guaranteed disconnect timer FIRST
        console.log(`⏰ Setting up 7-second force disconnect timer for ${channelName}`);
        const forceDisconnectTimer = setTimeout(() => {
            console.log(`⏰ 7 seconds elapsed, forcing disconnect from ${channelName}`);
            console.log(`🔍 Connection exists: ${voiceConnections.has(connectionKey)}`);
            console.log(`🔍 Player exists: ${audioPlayers.has(connectionKey)}`);
            cleanupConnection('7-second-timeout');
        }, 7000);

        // Handle connection events
        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('✅ Voice connection is ready!');
            
            try {
                // Create audio player and resource
                console.log(`🎼 Creating audio player and resource...`);
                const player = createAudioPlayer();
                const resource = createAudioResource(audioFilePath, {
                    inlineVolume: true
                });
                
                // Set volume
                resource.volume.setVolume(0.5);
                console.log(`🔊 Volume set to 50%`);
                
                // Store player
                audioPlayers.set(connectionKey, player);

                // Play the audio
                console.log(`▶️ Starting audio playback...`);
                player.play(resource);
                connection.subscribe(player);

                // Handle player events
                player.on(AudioPlayerStatus.Playing, () => {
                    console.log(`🎵 ✅ Audio is now playing in ${channelName}!`);
                });

                player.on(AudioPlayerStatus.Idle, () => {
                    console.log(`🎵 Audio finished playing in ${channelName}`);
                    
                    // Clear the force disconnect timer since we're handling it now
                    clearTimeout(forceDisconnectTimer);
                    
                    // Small delay to ensure audio finished cleanly, then disconnect
                    setTimeout(() => {
                        cleanupConnection('audio-finished');
                    }, 1000);
                });

                player.on('error', error => {
                    console.error('❌ Audio player error:', error);
                    
                    // Clear the force disconnect timer
                    clearTimeout(forceDisconnectTimer);
                    
                    // Cleanup on error
                    setTimeout(() => {
                        cleanupConnection('audio-error');
                    }, 500);
                });

            } catch (audioError) {
                console.error('❌ Error setting up audio:', audioError);
                
                // Clear the force disconnect timer
                clearTimeout(forceDisconnectTimer);
                
                // Clean up on setup error
                setTimeout(() => {
                    cleanupConnection('setup-error');
                }, 500);
            }
        });

        connection.on(VoiceConnectionStatus.Connecting, () => {
            console.log('🔄 Connecting to voice channel...');
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 Disconnected from voice channel: ${channelName}`);
            
            // Clear the force disconnect timer
            clearTimeout(forceDisconnectTimer);
            
            // Clean up when disconnected
            cleanupConnection('connection-disconnected');
        });

        connection.on('error', error => {
            console.error('❌ Voice connection error:', error);
            
            // Clear the force disconnect timer
            clearTimeout(forceDisconnectTimer);
            
            // Clean up on connection error
            setTimeout(() => {
                cleanupConnection('connection-error');
            }, 500);
        });

    } catch (error) {
        console.error('❌ Error in playAudio function:', error);
    }
}

// Enhanced error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

// Railway-specific process handling
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

function gracefulShutdown() {
    console.log('\n🌊 Bot shutting down gracefully...');
    
    voiceConnections.forEach((connection, key) => {
        console.log(`🔌 Destroying connection: ${key}`);
        try {
            connection.destroy();
        } catch (err) {
            console.log(`Error destroying connection ${key}:`, err.message);
        }
    });
    
    audioPlayers.forEach((player, key) => {
        console.log(`🎵 Stopping player: ${key}`);
        try {
            player.stop();
        } catch (err) {
            console.log(`Error stopping player ${key}:`, err.message);
        }
    });
    
    client.destroy();
    console.log('👋 Goodbye!');
    process.exit(0);
}

// Keep the process alive
setInterval(() => {
    console.log(`🏴‍☠️ Bot is alive - ${new Date().toISOString()}`);
}, 300000); // Log every 5 minutes

console.log('🚀 Starting bot...');
console.log('🔑 Token provided:', process.env.DISCORD_TOKEN ? 'Yes' : 'No');

client.login(process.env.DISCORD_TOKEN);
