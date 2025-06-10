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
        GatewayIntentBits.GuildMessages
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
                
                // Find or create category
                let category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
                if (!category) {
                    console.log(`📁 Creating category: ${categoryName}`);
                    category = await guild.channels.create({
                        name: categoryName,
                        type: ChannelType.GuildCategory,
                    });
                } else {
                    console.log(`📁 Found existing category: ${categoryName}`);
                }

                // Create new voice channel
                const randomName = onePieceLocations[Math.floor(Math.random() * onePieceLocations.length)];
                console.log(`🚢 Creating channel: ${randomName}`);
                
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

async function playAudio(channel, member) {
    console.log(`🎵 playAudio() called for channel: ${channel.name}`);
    
    try {
        // Check if audio file exists
        if (!fs.existsSync(audioFilePath)) {
            console.error('❌ Audio file not found, cannot play audio');
            return;
        }

        console.log(`🔌 Joining voice channel: ${channel.name}`);

        // Create voice connection
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        // Store connection
        const connectionKey = `${channel.guild.id}-${channel.id}`;
        voiceConnections.set(connectionKey, connection);
        console.log(`💾 Stored voice connection with key: ${connectionKey}`);

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
                    console.log(`🎵 ✅ Audio is now playing in ${channel.name}!`);
                });

                player.on(AudioPlayerStatus.Idle, () => {
                    console.log(`🎵 Audio finished playing in ${channel.name}`);
                });

                player.on('error', error => {
                    console.error('❌ Audio player error:', error);
                });

            } catch (audioError) {
                console.error('❌ Error setting up audio:', audioError);
            }
        });

        connection.on(VoiceConnectionStatus.Connecting, () => {
            console.log('🔄 Connecting to voice channel...');
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 Disconnected from voice channel: ${channel.name}`);
        });

        connection.on('error', error => {
            console.error('❌ Voice connection error:', error);
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

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🌊 Bot shutting down gracefully...');
    
    voiceConnections.forEach((connection, key) => {
        console.log(`🔌 Destroying connection: ${key}`);
        connection.destroy();
    });
    
    audioPlayers.forEach((player, key) => {
        console.log(`🎵 Stopping player: ${key}`);
        player.stop();
    });
    
    client.destroy();
    console.log('👋 Goodbye!');
    process.exit(0);
});

console.log('🚀 Starting bot...');
console.log('🔑 Token provided:', process.env.DISCORD_TOKEN ? 'Yes' : 'No');

client.login(process.env.DISCORD_TOKEN);
