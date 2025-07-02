const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
    ]
});

// One Piece themed channel names
const PIRATE_NAMES = [
    "🚢 Going Merry Voyage",
    "⚡ Thousand Sunny Journey", 
    "🏴‍☠️ Straw Hat Crew",
    "🌊 Alabasta Adventure",
    "🏝️ Water 7 Workshop",
    "⚔️ Enies Lobby Assault",
    "🐉 Thriller Bark Terror",
    "🌸 Sabaody Archipelago",
    "🔥 Impel Down Escape",
    "⚡ Marineford War",
    "🐠 Fishman Island",
    "🍭 Whole Cake Island",
    "⚔️ Wano Country",
    "🏴‍☠️ Red Hair Pirates",
    "💀 Whitebeard Territory",
    "🌊 Beast Pirates Lair",
    "👑 Big Mom's Domain",
    "⚡ Roger's Legacy",
    "🔥 Ace's Memory",
    "🌸 Cherry Blossom Dock",
    "🏝️ Skypiea Clouds",
    "⚡ Enel's Temple",
    "🐉 Kaido's Fortress",
    "🌊 Neptune's Palace",
    "🍖 Luffy's Kitchen",
    "⚔️ Zoro's Dojo",
    "🌸 Nami's Navigation",
    "🔧 Usopp's Workshop",
    "🍳 Sanji's Kitchen",
    "📚 Robin's Library",
    "🤖 Franky's Garage",
    "🎵 Brook's Concert"
];

let createdChannels = new Map();

client.once('ready', () => {
    console.log(`🏴‍☠️ ${client.user.tag} has set sail on the Grand Line!`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        // Handle joining the creation channel
        if (newState.channelId && newState.channel?.name === process.env.CREATE_CHANNEL_NAME) {
            await handleChannelCreation(newState);
        }

        // Handle leaving channels (cleanup empty channels)
        if (oldState.channelId && oldState.channelId !== newState.channelId) {
            await handleChannelCleanup(oldState);
        }
    } catch (error) {
        console.error('Error in voiceStateUpdate:', error);
    }
});

async function handleChannelCreation(voiceState) {
    const { member, guild } = voiceState;
    
    try {
        // Find or create category
        let category = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name === process.env.CATEGORY_NAME
        );
        
        if (!category) {
            category = await guild.channels.create({
                name: process.env.CATEGORY_NAME,
                type: ChannelType.GuildCategory
            });
        }

        // Get random pirate name
        const channelName = PIRATE_NAMES[Math.floor(Math.random() * PIRATE_NAMES.length)];
        
        // Create voice channel with LIMITED permissions for the creator
        const voiceChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    deny: [PermissionsBitField.Flags.Connect]
                },
                {
                    id: member.id, // Channel creator
                    allow: [
                        PermissionsBitField.Flags.Connect,
                        PermissionsBitField.Flags.Speak,
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.ManageChannels, // Can edit channel name, topic, etc.
                        PermissionsBitField.Flags.MoveMembers,    // Can move members between channels
                        PermissionsBitField.Flags.ManageRoles     // Can manage channel-specific permissions
                    ],
                    // Explicitly deny the problematic permissions
                    deny: [
                        PermissionsBitField.Flags.MuteMembers,   // Cannot server mute
                        PermissionsBitField.Flags.DeafenMembers  // Cannot server deafen
                    ]
                }
            ]
        });

        // Move the member to the new channel
        await member.voice.setChannel(voiceChannel);
        
        // Store channel info for cleanup
        createdChannels.set(voiceChannel.id, {
            creatorId: member.id,
            createdAt: Date.now()
        });

        // Play Going Merry sound effect if available
        await playWelcomeSound(voiceChannel);
        
        console.log(`⚓ Created channel "${channelName}" for Captain ${member.displayName}`);
        
    } catch (error) {
        console.error('Error creating voice channel:', error);
    }
}

async function handleChannelCleanup(oldState) {
    const channel = oldState.channel;
    
    if (!channel || !createdChannels.has(channel.id)) return;
    
    // Check if channel is empty
    if (channel.members.size === 0) {
        setTimeout(async () => {
            try {
                // Double check the channel still exists and is still empty
                const freshChannel = await channel.fetch();
                if (freshChannel.members.size === 0) {
                    await freshChannel.delete();
                    createdChannels.delete(channel.id);
                    console.log(`🗑️ Disbanded empty crew: ${channel.name}`);
                }
            } catch (error) {
                // Channel might already be deleted
                createdChannels.delete(channel.id);
            }
        }, parseInt(process.env.DELETE_DELAY) || 5000);
    }
}

async function playWelcomeSound(voiceChannel) {
    try {
        const soundPath = path.join(__dirname, 'sounds', 'The Going Merry One Piece - Cut.ogg');
        
        if (!fs.existsSync(soundPath)) {
            console.log('🎵 Sound file not found:', soundPath);
            console.log('🎵 Expected path:', soundPath);
            console.log('🎵 Current directory:', __dirname);
            return;
        }

        console.log('🎵 Playing sound:', soundPath);

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        
        // For .ogg files, specify the input type for better performance
        const resource = createAudioResource(soundPath, {
            inputType: StreamType.OggOpus,
        });
        
        // Add connection ready handler
        connection.on('ready', () => {
            console.log('🎵 Voice connection ready, starting playback');
            player.play(resource);
            connection.subscribe(player);
        });

        // Add player event handlers
        player.on(AudioPlayerStatus.Playing, () => {
            console.log('🎵 Audio started playing');
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('🎵 Audio finished playing');
            setTimeout(() => {
                connection.destroy();
            }, 1000);
        });

        player.on('error', (error) => {
            console.error('🎵 Audio player error:', error);
            connection.destroy();
        });

        // Add connection error handler
        connection.on('error', (error) => {
            console.error('🎵 Voice connection error:', error);
        });

        // Timeout fallback to prevent stuck connections
        setTimeout(() => {
            if (connection.state.status !== 'destroyed') {
                console.log('🎵 Audio timeout, destroying connection');
                connection.destroy();
            }
        }, 30000); // 30 second timeout

    } catch (error) {
        console.error('Error playing welcome sound:', error);
    }
}

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN);
