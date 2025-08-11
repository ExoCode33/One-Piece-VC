const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
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
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Track active voice connections and soundboard sessions
const activeConnections = new Map();
const soundboardSessions = new Map(); // channelId -> { player, repeatCount, currentFile, timeoutId }

// Sounds directory
const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');
const WELCOME_SOUND = path.join(SOUNDS_DIR, 'The Going Merry One Piece - Cut.ogg');

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

// Get available sound files
function getAvailableSounds() {
    if (!fs.existsSync(SOUNDS_DIR)) {
        fs.mkdirSync(SOUNDS_DIR, { recursive: true });
        return [];
    }
    
    return fs.readdirSync(SOUNDS_DIR)
        .filter(file => file.endsWith('.ogg') || file.endsWith('.mp3') || file.endsWith('.wav'))
        .map(file => {
            const name = path.parse(file).name;
            return {
                name: name,
                value: file,
                description: `Play ${name}`
            };
        });
}

// Stop any existing soundboard session in a channel
function stopSoundboardSession(channelId) {
    const session = soundboardSessions.get(channelId);
    if (session) {
        if (session.player) {
            session.player.stop();
        }
        if (session.timeoutId) {
            clearTimeout(session.timeoutId);
        }
        soundboardSessions.delete(channelId);
        debugLog(`🛑 Stopped soundboard session in channel ${channelId}`);
    }
}

// Play soundboard with repetition
async function playSoundboard(interaction, soundFile, repeatCount = 1) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        return interaction.reply({
            content: '❌ You need to be in a voice channel to use the soundboard!',
            flags: 64 // EPHEMERAL flag
        });
    }

    const soundPath = path.join(SOUNDS_DIR, soundFile);
    if (!fs.existsSync(soundPath)) {
        return interaction.reply({
            content: '❌ Sound file not found!',
            flags: 64 // EPHEMERAL flag
        });
    }

    try {
        // Stop any existing session in this channel
        stopSoundboardSession(voiceChannel.id);

        await interaction.deferReply();

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        activeConnections.set(voiceChannel.id, connection);

        const player = createAudioPlayer();
        let currentRepeat = 0;

        // Store session info
        soundboardSessions.set(voiceChannel.id, {
            player: player,
            repeatCount: repeatCount,
            currentFile: soundFile,
            timeoutId: null
        });

        function playSound() {
            if (currentRepeat >= repeatCount) {
                // Finished all repetitions - this should not happen here anymore
                debugLog(`🎵 All repetitions complete, cleanup will happen in Idle event`);
                return;
            }

            const resource = createAudioResource(soundPath, { 
                inlineVolume: true 
            });
            resource.volume.setVolume(AUDIO_VOLUME);

            player.play(resource);
            currentRepeat++;
            
            debugLog(`🎵 Playing ${soundFile} (${currentRepeat}/${repeatCount})`);
        }

        player.on(AudioPlayerStatus.Idle, () => {
            // When current playback ends, wait a moment then play again if needed
            const session = soundboardSessions.get(voiceChannel.id);
            if (session && currentRepeat < repeatCount) {
                session.timeoutId = setTimeout(() => {
                    playSound();
                }, 1000); // 1 second gap between repetitions
            } else {
                // All repetitions complete, disconnect after a short delay
                debugLog(`🎵 Audio finished, disconnecting in 2 seconds...`);
                setTimeout(() => {
                    if (activeConnections.has(voiceChannel.id)) {
                        debugLog(`🔌 Disconnecting bot from ${voiceChannel.name}`);
                        const conn = activeConnections.get(voiceChannel.id);
                        conn.destroy();
                        activeConnections.delete(voiceChannel.id);
                    }
                    stopSoundboardSession(voiceChannel.id);
                }, 2000);
            }
        });

        player.on('error', error => {
            console.error(`❌ Audio player error:`, error);
            stopSoundboardSession(voiceChannel.id);
            if (activeConnections.has(voiceChannel.id)) {
                connection.destroy();
                activeConnections.delete(voiceChannel.id);
            }
        });

        connection.subscribe(player);

        connection.on(VoiceConnectionStatus.Ready, () => {
            playSound(); // Start playing
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            debugLog(`🔌 Disconnected from ${voiceChannel.name}`);
            activeConnections.delete(voiceChannel.id);
            stopSoundboardSession(voiceChannel.id);
        });

        const soundName = path.parse(soundFile).name;
        const repeatText = repeatCount > 1 ? ` (${repeatCount} times)` : '';
        
        await interaction.editReply({
            content: `🎵 Now playing **${soundName}**${repeatText} in ${voiceChannel.name}!`
        });

    } catch (error) {
        console.error(`❌ Error playing soundboard:`, error);
        await interaction.editReply({
            content: '❌ Failed to play sound. Make sure I have permission to join your voice channel!'
        });
    }
}

// Welcome sound function (unchanged)
async function playWelcomeSound(channel) {
    try {
        if (!fs.existsSync(WELCOME_SOUND)) {
            debugLog(`Welcome sound file not found: ${WELCOME_SOUND}`);
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
        const resource = createAudioResource(WELCOME_SOUND, { 
            inlineVolume: true 
        });
        
        resource.volume.setVolume(AUDIO_VOLUME);

        player.play(resource);
        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
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
            activeConnections.delete(channel.id);
        });

    } catch (error) {
        console.error(`❌ Error playing welcome sound:`, error);
    }
}

// Register slash commands
async function registerCommands() {
    const sounds = getAvailableSounds();
    log(`🔍 Found ${sounds.length} sound files for commands`);
    
    const commands = [
        new SlashCommandBuilder()
            .setName('soundboard')
            .setDescription('Play sounds from the soundboard')
            .addStringOption(option => {
                option
                    .setName('sound')
                    .setDescription('Choose a sound to play')
                    .setRequired(true);
                
                // Add sound choices (Discord limits to 25 choices)
                if (sounds.length === 0) {
                    // Add dummy choice if no sounds found
                    option.addChoices({ name: 'No sounds found', value: 'none' });
                } else {
                    // Add up to 25 sounds
                    sounds.slice(0, 25).forEach(sound => {
                        // Clean up the name for Discord (max 100 chars)
                        const cleanName = sound.name.length > 100 ? sound.name.substring(0, 97) + '...' : sound.name;
                        option.addChoices({ name: cleanName, value: sound.value });
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
                    .setDescription('How many times to repeat the sound (1-10)')
                    .setMinValue(1)
                    .setMaxValue(10)
                    .setRequired(false)
            ),
        
        new SlashCommandBuilder()
            .setName('playsound')
            .setDescription('Play a sound by typing its name (alternative to dropdown)')
            .addStringOption(option =>
                option
                    .setName('filename')
                    .setDescription('Type the exact filename (e.g., airhorn.ogg)')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option
                    .setName('repeat')
                    .setDescription('How many times to repeat the sound (1-10)')
                    .setMinValue(1)
                    .setMaxValue(10)
                    .setRequired(false)
            ),
        
        new SlashCommandBuilder()
            .setName('stopsound')
            .setDescription('Stop the current soundboard playback'),
            
        new SlashCommandBuilder()
            .setName('sounds')
            .setDescription('List all available sounds'),
            
        new SlashCommandBuilder()
            .setName('refreshsounds')
            .setDescription('Refresh the sound list (admin only)'),
            
        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Check if the bot is responsive'),
    ];

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    try {
        log('🔄 Refreshing slash commands...');
        
        // Log what sounds we're registering
        if (sounds.length > 0) {
            log(`📝 Registering commands with sounds: ${sounds.slice(0, 5).map(s => s.name).join(', ')}${sounds.length > 5 ? '...' : ''}`);
        } else {
            log('⚠️ No sound files found - commands will show "No sounds found"');
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
    log(`One Piece Voice Bot is ready to set sail!`);
    log(`⚓ Logged in as ${client.user.tag}`);
    log(`🎵 Soundboard enabled with ${getAvailableSounds().length} sounds`);
    
    // Create sounds directory if it doesn't exist
    if (!fs.existsSync(SOUNDS_DIR)) {
        fs.mkdirSync(SOUNDS_DIR, { recursive: true });
        log(`📁 Created sounds directory: ${SOUNDS_DIR}`);
        log(`💡 Add your sound files (.ogg, .mp3, .wav) to the sounds folder!`);
    }
    
    await registerCommands();
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ping') {
        await interaction.reply({
            content: '🏴‍☠️ Pong! Bot is working!',
            flags: 64 // EPHEMERAL flag
        });
    }

    else if (commandName === 'soundboard') {
        const soundFile = interaction.options.getString('sound');
        const repeatCount = interaction.options.getInteger('repeat') || 1;
        
        if (soundFile === 'none') {
            return interaction.reply({
                content: '❌ No sound files found! Add .ogg, .mp3, or .wav files to the sounds folder and use `/refreshsounds`.',
                flags: 64 // EPHEMERAL flag
            });
        }
        
        await playSoundboard(interaction, soundFile, repeatCount);
    }
    
    else if (commandName === 'playsound') {
        const filename = interaction.options.getString('filename');
        const repeatCount = interaction.options.getInteger('repeat') || 1;
        
        // Check if file exists
        const soundPath = path.join(SOUNDS_DIR, filename);
        if (!fs.existsSync(soundPath)) {
            return interaction.reply({
                content: `❌ Sound file "${filename}" not found! Use \`/sounds\` to see available files.`,
                flags: 64 // EPHEMERAL flag
            });
        }
        
        await playSoundboard(interaction, filename, repeatCount);
    }
    
    else if (commandName === 'refreshsounds') {
        // Check if user has admin permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need administrator permissions to refresh sounds!',
                flags: 64 // EPHEMERAL flag
            });
        }
        
        await interaction.deferReply({ flags: 64 }); // EPHEMERAL flag
        
        try {
            await registerCommands();
            const sounds = getAvailableSounds();
            await interaction.editReply({
                content: `✅ Sound commands refreshed! Found ${sounds.length} sound files.\n\n**Note:** You may need to restart Discord or wait a few minutes for the new sounds to appear in the dropdown.`
            });
        } catch (error) {
            console.error('Error refreshing commands:', error);
            await interaction.editReply({
                content: '❌ Failed to refresh sound commands. Check console for errors.'
            });
        }
    }
    
    else if (commandName === 'stopsound') {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        
        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ You need to be in a voice channel!',
                flags: 64 // EPHEMERAL flag
            });
        }
        
        stopSoundboardSession(voiceChannel.id);
        
        if (activeConnections.has(voiceChannel.id)) {
            const connection = activeConnections.get(voiceChannel.id);
            connection.destroy();
            activeConnections.delete(voiceChannel.id);
            debugLog(`🔌 Force disconnected bot from voice channel`);
        }
        
        await interaction.reply({
            content: '🛑 Stopped soundboard playback!',
            flags: 64 // EPHEMERAL flag
        });
    }
    
    else if (commandName === 'sounds') {
        const sounds = getAvailableSounds();
        
        if (sounds.length === 0) {
            return interaction.reply({
                content: '❌ No sound files found! Add .ogg, .mp3, or .wav files to the sounds folder.\n\n**Steps:**\n1. Add sound files to the `sounds` folder\n2. Use `/refreshsounds` (admin only)\n3. Restart the bot if needed',
                flags: 64 // EPHEMERAL flag
            });
        }
        
        // Split into chunks if too many sounds
        const soundList = sounds.map((sound, index) => `${index + 1}. **${sound.name}** \`(${sound.value})\``).join('\n');
        
        if (soundList.length > 2000) {
            // Split into multiple messages if too long
            const firstHalf = sounds.slice(0, Math.ceil(sounds.length / 2));
            const secondHalf = sounds.slice(Math.ceil(sounds.length / 2));
            
            const firstList = firstHalf.map((sound, index) => `${index + 1}. **${sound.name}** \`(${sound.value})\``).join('\n');
            
            await interaction.reply({
                content: `🎵 **Available Sounds (${sounds.length}) - Part 1:**\n\n${firstList}`,
                flags: 64 // EPHEMERAL flag
            });
            
            const secondList = secondHalf.map((sound, index) => `${firstHalf.length + index + 1}. **${sound.name}** \`(${sound.value})\``).join('\n');
            
            await interaction.followUp({
                content: `🎵 **Available Sounds - Part 2:**\n\n${secondList}\n\n💡 **Tip:** Use \`/playsound filename:sound.ogg\` to play any sound by typing its filename!`,
                flags: 64 // EPHEMERAL flag
            });
        } else {
            await interaction.reply({
                content: `🎵 **Available Sounds (${sounds.length}):**\n\n${soundList}\n\n💡 **Tip:** Use \`/playsound filename:sound.ogg\` to play any sound by typing its filename!`,
                flags: 64 // EPHEMERAL flag
            });
        }
    }
});

// Voice state update handler (unchanged for channel creation)
client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.id;
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

            if (newChannel.parentId !== category.id) {
                try {
                    await newChannel.setParent(category.id);
                    debugLog(`🔧 Manually moved ${crewName} to category ${category.name}`);
                } catch (moveError) {
                    console.error(`❌ Error moving channel to category:`, moveError);
                }
            }

            log(`🚢 Created new crew: ${crewName} for ${member.displayName}`);

            try {
                if (member.voice.channelId) {
                    await member.voice.setChannel(newChannel);
                    
                    setTimeout(() => {
                        playWelcomeSound(newChannel);
                    }, 1000);
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
                
                // Stop any soundboard session
                stopSoundboardSession(oldChannel.id);
                
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

// Legacy message handler for testing (optional)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    if (message.content === '!ping') {
        message.reply('🏴‍☠️ Pong! Bot is working! Use `/ping` for slash command.');
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
    log('🛑 Shutting down bot...');
    
    // Clean up voice connections and soundboard sessions
    activeConnections.forEach(connection => connection.destroy());
    activeConnections.clear();
    
    soundboardSessions.forEach((session, channelId) => {
        stopSoundboardSession(channelId);
    });
    
    client.destroy();
    process.exit(0);
}

// Keep the process alive
setInterval(() => {
    if (DEBUG) {
        console.log(`🏴‍☠️ Bot alive - Connections: ${activeConnections.size}, Sessions: ${soundboardSessions.size}`);
    }
}, 300000); // Log every 5 minutes in debug mode

// Start the bot
log('🚀 Starting One Piece Soundboard Bot...');
log(`🔑 Token: ${DISCORD_TOKEN ? 'Provided' : 'MISSING'}`);
log(`🆔 Client ID: ${CLIENT_ID ? 'Provided' : 'MISSING'}`);

client.login(DISCORD_TOKEN).catch(error => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
});
