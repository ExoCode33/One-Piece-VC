const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Configuration from environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CREATE_CHANNEL_NAME = process.env.CREATE_CHANNEL_NAME || '🏴 Set Sail Together';
const CATEGORY_NAME = process.env.CATEGORY_NAME || '🌊 Grand Line Voice Channels';
const DELETE_DELAY = parseInt(process.env.DELETE_DELAY) || 5000;
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
    '⚓ Going Merry'
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

// Get available Discord soundboard sounds for the guild
async function getGuildSoundboardSounds(guild) {
    try {
        // Fetch guild soundboard sounds
        const sounds = await guild.soundboardSounds.fetch();
        return sounds.map(sound => ({
            id: sound.id,
            name: sound.name,
            emoji: sound.emoji,
            description: `Play ${sound.name}`
        }));
    } catch (error) {
        console.error('❌ Error fetching soundboard sounds:', error);
        return [];
    }
}

// Play Discord native soundboard sound
async function playDiscordSoundboard(interaction, soundId, repeatCount = 1) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        return interaction.reply({
            content: '❌ You need to be in a voice channel to use the soundboard!',
            flags: 64 // EPHEMERAL flag
        });
    }

    try {
        await interaction.deferReply();

        // Find the sound
        const guild = interaction.guild;
        const sounds = await guild.soundboardSounds.fetch();
        const sound = sounds.get(soundId);
        
        if (!sound) {
            return interaction.editReply({
                content: '❌ Sound not found! Use `/sounds` to see available sounds.'
            });
        }

        let playCount = 0;
        
        async function playSound() {
            if (playCount >= repeatCount) {
                return;
            }
            
            try {
                // Use Discord's native soundboard API
                await member.voice.channel.sendSoundboardSound(soundId, member.id);
                playCount++;
                
                debugLog(`🎵 Played Discord soundboard: ${sound.name} (${playCount}/${repeatCount})`);
                
                // If more repetitions needed, wait and play again
                if (playCount < repeatCount) {
                    setTimeout(() => {
                        playSound();
                    }, 2000); // 2 second gap between repetitions
                }
            } catch (playError) {
                console.error('❌ Error playing soundboard sound:', playError);
                throw playError;
            }
        }

        await playSound();

        const repeatText = repeatCount > 1 ? ` (${repeatCount} times)` : '';
        await interaction.editReply({
            content: `🎵 Playing Discord soundboard: **${sound.name}**${repeatText} in ${voiceChannel.name}!`
        });

    } catch (error) {
        console.error(`❌ Error playing Discord soundboard:`, error);
        
        let errorMessage = '❌ Failed to play sound.';
        
        if (error.code === 50013) {
            errorMessage += ' Bot needs "Use Soundboard" permission!';
        } else if (error.code === 40032) {
            errorMessage += ' Sound not found or unavailable!';
        } else {
            errorMessage += ' Make sure the bot has soundboard permissions!';
        }
        
        if (interaction.deferred) {
            await interaction.editReply({ content: errorMessage });
        } else {
            await interaction.reply({ content: errorMessage, flags: 64 });
        }
    }
}

// Register slash commands with dynamic soundboard choices
async function registerCommands(guild = null) {
    let sounds = [];
    
    if (guild) {
        sounds = await getGuildSoundboardSounds(guild);
        log(`🔍 Found ${sounds.length} Discord soundboard sounds`);
    }
    
    const commands = [
        new SlashCommandBuilder()
            .setName('soundboard')
            .setDescription('Play sounds from Discord\'s built-in soundboard')
            .addStringOption(option => {
                option
                    .setName('sound')
                    .setDescription('Choose a sound to play')
                    .setRequired(true);
                
                // Add sound choices (Discord limits to 25 choices)
                if (sounds.length === 0) {
                    option.addChoices({ name: 'No sounds found - upload sounds to server soundboard', value: 'none' });
                } else {
                    sounds.slice(0, 25).forEach(sound => {
                        const displayName = sound.emoji ? `${sound.emoji} ${sound.name}` : sound.name;
                        const cleanName = displayName.length > 100 ? displayName.substring(0, 97) + '...' : displayName;
                        option.addChoices({ name: cleanName, value: sound.id });
                    });
                    
                    if (sounds.length > 25) {
                        log(`⚠️ Warning: ${sounds.length} sounds found, but only showing first 25 in dropdown`);
                    }
                }
                
                return option;
            })
            .addIntegerOption(option =>
                option
                    .setName('repeat')
                    .setDescription('How many times to repeat the sound (1-5)')
                    .setMinValue(1)
                    .setMaxValue(5)
                    .setRequired(false)
            ),
        
        new SlashCommandBuilder()
            .setName('sounds')
            .setDescription('List all available Discord soundboard sounds'),
            
        new SlashCommandBuilder()
            .setName('refreshsounds')
            .setDescription('Refresh the Discord soundboard list (admin only)'),
            
        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Check if the bot is responsive'),
    ];

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    try {
        log('🔄 Refreshing slash commands...');
        
        if (sounds.length > 0) {
            log(`📝 Registering commands with Discord soundboard sounds: ${sounds.slice(0, 3).map(s => s.name).join(', ')}${sounds.length > 3 ? '...' : ''}`);
        } else {
            log('⚠️ No Discord soundboard sounds found - users need to upload sounds to server');
        }
        
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        log('✅ Slash commands registered successfully!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
        console.error('Full error:', error.message);
    }
}

// Bot event handlers
client.once('ready', async () => {
    log(`Discord Soundboard Bot is ready to set sail!`);
    log(`⚓ Logged in as ${client.user.tag}`);
    log(`🎵 Using Discord's native soundboard system`);
    log(`💡 Users need to upload sounds to server soundboard for bot to use them`);
    
    // Register commands with the first guild (for guild-specific soundboards)
    const guild = client.guilds.cache.first();
    if (guild) {
        await registerCommands(guild);
    } else {
        await registerCommands();
    }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ping') {
        await interaction.reply({
            content: '🏴‍☠️ Pong! Discord Soundboard Bot is working!',
            flags: 64
        });
    }

    else if (commandName === 'soundboard') {
        const soundId = interaction.options.getString('sound');
        const repeatCount = interaction.options.getInteger('repeat') || 1;
        
        if (soundId === 'none') {
            return interaction.reply({
                content: '❌ No Discord soundboard sounds found!\n\n**How to add sounds:**\n1. Go to Server Settings → Soundboard\n2. Upload your sound files\n3. Use `/refreshsounds` to update the bot',
                flags: 64
            });
        }
        
        await playDiscordSoundboard(interaction, soundId, repeatCount);
    }
    
    else if (commandName === 'refreshsounds') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need administrator permissions to refresh sounds!',
                flags: 64
            });
        }
        
        await interaction.deferReply({ flags: 64 });
        
        try {
            await registerCommands(interaction.guild);
            const sounds = await getGuildSoundboardSounds(interaction.guild);
            await interaction.editReply({
                content: `✅ Discord soundboard refreshed! Found ${sounds.length} sounds.\n\n**Note:** Restart Discord or wait a few minutes for new sounds to appear in the dropdown.`
            });
        } catch (error) {
            console.error('Error refreshing commands:', error);
            await interaction.editReply({
                content: '❌ Failed to refresh soundboard. Check console for errors.'
            });
        }
    }
    
    else if (commandName === 'sounds') {
        const sounds = await getGuildSoundboardSounds(interaction.guild);
        
        if (sounds.length === 0) {
            return interaction.reply({
                content: '❌ No Discord soundboard sounds found!\n\n**How to add sounds:**\n1. Go to **Server Settings** → **Soundboard**\n2. Click **Upload Sound**\n3. Add your .mp3, .ogg, or .wav files\n4. Give them names and emojis\n5. Use `/refreshsounds` to update the bot\n\n🎵 **Benefits of Discord Soundboard:**\n• Can\'t be muted by users\n• Better performance\n• Native Discord integration',
                flags: 64
            });
        }
        
        const soundList = sounds.map((sound, index) => {
            const emoji = sound.emoji ? `${sound.emoji} ` : '';
            return `${index + 1}. ${emoji}**${sound.name}**`;
        }).join('\n');
        
        if (soundList.length > 2000) {
            // Split into multiple messages if too long
            const firstHalf = sounds.slice(0, Math.ceil(sounds.length / 2));
            const secondHalf = sounds.slice(Math.ceil(sounds.length / 2));
            
            const firstList = firstHalf.map((sound, index) => {
                const emoji = sound.emoji ? `${sound.emoji} ` : '';
                return `${index + 1}. ${emoji}**${sound.name}**`;
            }).join('\n');
            
            await interaction.reply({
                content: `🎵 **Discord Soundboard Sounds (${sounds.length}) - Part 1:**\n\n${firstList}`,
                flags: 64
            });
            
            const secondList = secondHalf.map((sound, index) => {
                const emoji = sound.emoji ? `${sound.emoji} ` : '';
                return `${firstHalf.length + index + 1}. ${emoji}**${sound.name}**`;
            }).join('\n');
            
            await interaction.followUp({
                content: `🎵 **Discord Soundboard Sounds - Part 2:**\n\n${secondList}\n\n💡 **Tip:** These sounds can't be muted by users!`,
                flags: 64
            });
        } else {
            await interaction.reply({
                content: `🎵 **Discord Soundboard Sounds (${sounds.length}):**\n\n${soundList}\n\n💡 **Tip:** These sounds can't be muted by users!`,
                flags: 64
            });
        }
    }
});

// Voice state update handler for dynamic channels (unchanged)
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;

    try {
        // Dynamic Voice Channel Creation
        if (newState.channelId && newState.channel?.name === CREATE_CHANNEL_NAME) {
            const guild = newState.guild;
            
            if (!member.voice.channelId) {
                debugLog(`User ${member.displayName} no longer in voice, skipping channel creation`);
                return;
            }
            
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
            }

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
                            PermissionFlagsBits.MoveMembers
                        ]
                    }
                ]
            });

            log(`🚢 Created new crew: ${crewName} for ${member.displayName}`);

            try {
                if (member.voice.channelId) {
                    await member.voice.setChannel(newChannel);
                }
            } catch (moveError) {
                console.error(`❌ Error moving user to new channel:`, moveError);
            }
        }

        // Auto-delete empty dynamic channels
        if (oldState.channelId) {
            const oldChannel = oldState.channel;
            if (oldChannel && 
                oldChannel.name !== CREATE_CHANNEL_NAME && 
                oldChannel.parent?.name === CATEGORY_NAME &&
                oldChannel.members.size === 0) {
                
                setTimeout(async () => {
                    try {
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

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

function gracefulShutdown() {
    log('🛑 Shutting down Discord Soundboard Bot...');
    client.destroy();
    process.exit(0);
}

// Start the bot
log('🚀 Starting Discord Soundboard Bot...');
log(`🔑 Token: ${DISCORD_TOKEN ? 'Provided' : 'MISSING'}`);
log(`🆔 Client ID: ${CLIENT_ID ? 'Provided' : 'MISSING'}`);

client.login(DISCORD_TOKEN).catch(error => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
});
