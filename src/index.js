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

// One Piece themed channel names - Lore accurate locations
const onePieceLocations = [
    // Ships
    "🏴‍☠️ Going Merry Crew",
    "⚓ Thousand Sunny Squad",
    "🚢 Red Force Fleet",
    "⛵ Moby Dick Division",
    "🛥️ Polar Tang Submarine",
    
    // Grand Line Islands
    "🏝️ Water 7 Workshop",
    "🌊 Enies Lobby Expedition",
    "🏴‍☠️ Alabasta Adventure",
    "🏖️ Skypiea Sanctuary",
    "🌋 Drum Island Doctors",
    "🌸 Sakura Kingdom",
    "🏛️ Ohara Scholars",
    "🌙 Thriller Bark",
    "🐠 Fish-Man Island",
    "🌺 Amazon Lily",
    "⚡ Raijin Island",
    "🎪 Long Ring Long Land",
    "🏰 Mariejois Marines",
    "🌊 Sabaody Archipelago",
    "🔥 Punk Hazard",
    "🍰 Whole Cake Island",
    "🌸 Wano Country",
    "🦅 Jaya Skyward",
    "🌊 Reverse Mountain",
    "🏝️ Little Garden",
    "🦴 Bone Cape",
    "🌪️ Whisky Peak",
    "🌊 Loguetown",
    "🏔️ Twin Cape",
    
    // New World Islands
    "💎 Dressrosa Arena",
    "🌊 Zou Elephant",
    "🔥 Tottoland Territory",
    "⚔️ Onigashima Raid",
    "🌊 Egghead Island",
    "🏝️ Elbaf Giants",
    "🌊 Laugh Tale",
    "🔥 God Valley",
    "🌊 Lodestar Island",
    
    // Marine Bases
    "⚓ Marine Base G-8",
    "🏛️ Marineford HQ",
    "⚓ Impel Down",
    "🏛️ Navy Base 153",
    
    // Crew Hangouts
    "🍖 Baratie Kitchen",
    "📚 Ohara Library",
    "🎭 Orange Town",
    "🌊 Cocoyasi Village",
    "🐑 Syrup Village",
    "🏥 Drum Castle",
    "🌸 Bell-mère's Grove"
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

    // User joined the trigger channel
    if (newState.channel && newState.channel.name === createChannelName) {
        console.log('🎯 User joined the create channel!');
        
        try {
            const guild = newState.guild;
            const member = newState.member;
            
            console.log(`🏴‍☠️ Creating new crew for ${member.displayName}...`);
            
            // Find or create category
            let category = newState.channel.parent;
            if (!category) {
                category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
                if (!category) {
                    category = await guild.channels.create({
                        name: categoryName,
                        type: ChannelType.GuildCategory,
                    });
                }
            }

            // Create new voice channel right below the trigger channel
            const randomName = onePieceLocations[Math.floor(Math.random() * onePieceLocations.length)];
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

            // Move the new channel to be directly below the trigger channel
            await newChannel.setPosition(newState.channel.position + 1);

            console.log(`✅ Channel created: ${newChannel.name}`);

            // Move user to new channel
            await member.voice.setChannel(newChannel);
            console.log(`✅ User moved to new channel`);

            // Play audio with 6-second auto-disconnect
            await playAudio(newChannel);

        } catch (error) {
            console.error('❌ Error creating channel:', error);
        }
    }

    // Handle channel cleanup when empty
    if (oldState.channel && 
        oldState.channel.parent && 
        oldState.channel.parent.name === categoryName &&
        oldState.channel.name !== createChannelName &&
        oldState.channel.members.size === 0) {
        
        const channelToDelete = oldState.channel; // Store reference before timeout
        const channelName = channelToDelete.name; // Store name before timeout
        
        console.log(`🧹 Channel empty: ${channelName} - deleting in 1 second`);
        
        setTimeout(async () => {
            try {
                if (channelToDelete && channelToDelete.members.size === 0) {
                    await channelToDelete.delete();
                    console.log(`🗑️ Deleted empty channel: ${channelName}`);
                }
            } catch (error) {
                console.error('❌ Error deleting channel:', error);
            }
        }, 1000);
    }
});

// Simple message commands
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (message.content === '!ping') {
        message.reply('🏴‍☠️ Pong! Bot is working!');
    }
    
    if (message.content === '!forceLeave') {
        if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            message.reply('❌ You need administrator permissions!');
            return;
        }
        
        let cleaned = 0;
        voiceConnections.forEach((connection, key) => {
            try {
                // Only destroy if not already destroyed
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
                cleaned++;
            } catch (err) {
                console.log(`Error destroying connection: ${err.message}`);
            }
        });
        
        voiceConnections.clear();
        audioPlayers.clear();
        
        message.reply(`🧹 Cleaned up ${cleaned} voice connections!`);
    }
    
    if (message.content === '!status') {
        const status = `📊 Active connections: ${voiceConnections.size} | Active players: ${audioPlayers.size}`;
        message.reply(status);
    }
});

async function playAudio(channel) {
    const channelName = channel.name;
    const channelId = channel.id;
    const guildId = channel.guild.id;
    const connectionKey = `${guildId}-${channelId}`;
    
    console.log(`🎵 Playing audio in ${channelName}`);
    
    try {
        if (!fs.existsSync(audioFilePath)) {
            console.error('❌ Audio file not found');
            return;
        }

        // Join voice channel
        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        voiceConnections.set(connectionKey, connection);

        // Set 6-second auto-disconnect timer
        const disconnectTimer = setTimeout(() => {
            console.log(`⏰ 6 seconds elapsed - disconnecting from ${channelName}`);
            try {
                if (voiceConnections.has(connectionKey)) {
                    const conn = voiceConnections.get(connectionKey);
                    // Check if connection is not already destroyed
                    if (conn.state.status !== VoiceConnectionStatus.Destroyed) {
                        conn.destroy();
                        console.log(`🔌 Connection destroyed for ${channelName}`);
                    }
                    voiceConnections.delete(connectionKey);
                }
                if (audioPlayers.has(connectionKey)) {
                    const player = audioPlayers.get(connectionKey);
                    player.stop();
                    audioPlayers.delete(connectionKey);
                }
                console.log(`✅ Bot disconnected from ${channelName}`);
            } catch (error) {
                console.error('❌ Error during disconnect:', error);
            }
        }, 6000); // 6 seconds

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log(`🔌 Connected to ${channelName}`);
            
            try {
                const player = createAudioPlayer();
                const resource = createAudioResource(audioFilePath, {
                    inlineVolume: true
                });
                
                resource.volume.setVolume(0.5);
                audioPlayers.set(connectionKey, player);

                player.play(resource);
                connection.subscribe(player);

                player.on(AudioPlayerStatus.Playing, () => {
                    console.log(`🎵 Audio playing in ${channelName}`);
                });

                player.on(AudioPlayerStatus.Idle, () => {
                    console.log(`🎵 Audio finished in ${channelName}`);
                });

            } catch (audioError) {
                console.error('❌ Error setting up audio:', audioError);
            }
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 Disconnected from ${channelName}`);
            clearTimeout(disconnectTimer);
            voiceConnections.delete(connectionKey);
            audioPlayers.delete(connectionKey);
        });

    } catch (error) {
        console.error('❌ Error in playAudio:', error);
    }
}

// Graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

function gracefulShutdown() {
    console.log('🌊 Bot shutting down gracefully...');
    
    voiceConnections.forEach((connection, key) => {
        try {
            // Only destroy if not already destroyed
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy();
            }
        } catch (err) {
            console.log(`Error destroying connection: ${err.message}`);
        }
    });
    
    audioPlayers.forEach((player, key) => {
        try {
            player.stop();
        } catch (err) {
            console.log(`Error stopping player: ${err.message}`);
        }
    });
    
    client.destroy();
    process.exit(0);
}

console.log('🚀 Starting bot...');
client.login(process.env.DISCORD_TOKEN);
