const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

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
    "🏴‍☠️ Alabasta Adventure",
    "⭐ Sky Island Sojourn",
    "🐟 Fish-Man Island Fleet",
    "🌋 Punk Hazard Patrol",
    "🍰 Whole Cake Crew",
    "🗾 Wano Country Warriors",
    "🏴‍☠️ Marineford Marines",
    "🏝️ Thriller Bark Brigade",
    "⚡ Skypiea Sailors",
    "🌊 Amazon Lily Alliance",
    "🏴‍☠️ Impel Down Inmates",
    "🎭 Sabaody Archipelago",
    "🌊 Reverse Mountain Rally",
    "🐘 Zou Expedition",
    "🌸 Drum Island Doctors",
    "🏴‍☠️ Arlong Park Pirates",
    "🍖 Baratie Chefs",
    "🎪 Orange Town Outcasts",
    "🌊 Loguetown Legends",
    "⚔️ Whiskey Peak Warriors",
    "🏝️ Little Garden Giants",
    "🌊 Twin Cape Crew",
    "🏴‍☠️ Mocktown Misfits",
    "⚡ Upper Yard Unit",
    "🌊 Long Ring Island",
    "🏴‍☠️ Jaya Journey"
];

// Store active voice connections and audio players
const voiceConnections = new Map();
const audioPlayers = new Map();

// Audio file path
const audioFilePath = path.join(__dirname, '..', 'sounds', 'The Going Merry One Piece - Cut.ogg');

client.once('ready', () => {
    console.log(`🏴‍☠️ ${client.user.tag} is ready to sail the Grand Line!`);
    
    // Verify audio file exists
    if (!fs.existsSync(audioFilePath)) {
        console.error('❌ Audio file not found at:', audioFilePath);
        console.log('Make sure "The Going Merry One Piece - Cut.ogg" is in the sounds folder');
    } else {
        console.log('🎵 Audio file found and ready!');
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    const createChannelName = process.env.CREATE_CHANNEL_NAME || '🏴‍☠️ Set Sail Together';
    const categoryName = process.env.CATEGORY_NAME || '🌊 Grand Line Voice Channels';
    const deleteDelay = parseInt(process.env.DELETE_DELAY) || 5000;

    // User joined the create channel
    if (newState.channel && newState.channel.name === createChannelName) {
        try {
            const guild = newState.guild;
            const member = newState.member;
            
            // Find or create category
            let category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
            if (!category) {
                category = await guild.channels.create({
                    name: categoryName,
                    type: ChannelType.GuildCategory,
                });
            }

            // Create new voice channel with random One Piece name
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

            // Move user to new channel
            await member.voice.setChannel(newChannel);
            
            console.log(`🏴‍☠️ Created new crew: ${randomName} for Captain ${member.displayName}`);

            // Play audio when user joins the new channel
            await playAudio(newChannel, member);

        } catch (error) {
            console.error('❌ Error creating voice channel:', error);
        }
    }

    // Handle channel cleanup
    if (oldState.channel && 
        oldState.channel.parent && 
        oldState.channel.parent.name === categoryName &&
        oldState.channel.name !== createChannelName) {
        
        // Check if channel is empty
        if (oldState.channel.members.size === 0) {
            setTimeout(async () => {
                try {
                    // Double-check if still empty before deleting
                    if (oldState.channel.members.size === 0) {
                        // Clean up voice connection and audio player
                        const connectionKey = `${oldState.channel.guild.id}-${oldState.channel.id}`;
                        
                        if (voiceConnections.has(connectionKey)) {
                            const connection = voiceConnections.get(connectionKey);
                            connection.destroy();
                            voiceConnections.delete(connectionKey);
                        }
                        
                        if (audioPlayers.has(connectionKey)) {
                            const player = audioPlayers.get(connectionKey);
                            player.stop();
                            audioPlayers.delete(connectionKey);
                        }

                        await oldState.channel.delete();
                        console.log(`🌊 Disbanded empty crew: ${oldState.channel.name}`);
                    }
                } catch (error) {
                    console.error('❌ Error deleting voice channel:', error);
                }
            }, deleteDelay);
        }
    }
});

async function playAudio(channel, member) {
    try {
        // Check if audio file exists
        if (!fs.existsSync(audioFilePath)) {
            console.error('❌ Audio file not found, skipping audio playback');
            return;
        }

        // Create voice connection
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        // Store connection for cleanup
        const connectionKey = `${channel.guild.id}-${channel.id}`;
        voiceConnections.set(connectionKey, connection);

        // Wait for connection to be ready
        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('🎵 Voice connection established, playing audio...');
            
            // Create audio player and resource
            const player = createAudioPlayer();
            const resource = createAudioResource(audioFilePath, {
                inlineVolume: true
            });
            
            // Set volume (0.5 = 50% volume)
            resource.volume.setVolume(0.3);
            
            // Store player for cleanup
            audioPlayers.set(connectionKey, player);

            // Play the audio
            player.play(resource);
            connection.subscribe(player);

            // Handle player events
            player.on(AudioPlayerStatus.Playing, () => {
                console.log(`🎵 Now playing Going Merry theme in ${channel.name}`);
            });

            player.on(AudioPlayerStatus.Idle, () => {
                console.log(`🎵 Audio finished in ${channel.name}`);
                // Optionally leave the channel after audio finishes
                // connection.destroy();
            });

            player.on('error', error => {
                console.error('❌ Audio player error:', error);
            });
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🌊 Voice connection disconnected from ${channel.name}`);
        });

        connection.on('error', error => {
            console.error('❌ Voice connection error:', error);
        });

    } catch (error) {
        console.error('❌ Error playing audio:', error);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('🌊 Bot shutting down...');
    
    // Clean up all voice connections
    voiceConnections.forEach(connection => {
        connection.destroy();
    });
    
    // Stop all audio players
    audioPlayers.forEach(player => {
        player.stop();
    });
    
    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
