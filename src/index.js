const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, createAudioReceiver } = require('@discordjs/voice');
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
const soundboardSessions = new Map();
const voiceDetectionSessions = new Map(); // channelId -> { enabled, selectedSound, connection, receiver, targetUserId, isTargetSpeaking, soundLoop }

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

// Stop voice detection in a channel
function stopVoiceDetection(channelId) {
    const session = voiceDetectionSessions.get(channelId);
    if (session) {
        session.enabled = false;
        if (session.soundLoop) {
            clearInterval(session.soundLoop);
        }
        if (session.connection) {
            session.connection.destroy();
        }
        voiceDetectionSessions.delete(channelId);
        if (activeConnections.has(channelId)) {
            activeConnections.delete(channelId);
        }
        debugLog(`🛑 Stopped voice detection in channel ${channelId}`);
    }
}

// Play sound continuously while target user is speaking
async function startSoundLoop(channelId, soundFile) {
    const session = voiceDetectionSessions.get(channelId);
    if (!session || !session.enabled || !session.isTargetSpeaking) return;
    
    const soundPath = path.join(SOUNDS_DIR, soundFile);
    if (!fs.existsSync(soundPath)) {
        debugLog(`🔊 Detection sound not found: ${soundFile}`);
        return;
    }

    try {
        const player = createAudioPlayer();
        const resource = createAudioResource(soundPath, { 
            inlineVolume: true 
        });
        resource.volume.setVolume(AUDIO_VOLUME);

        player.play(resource);
        session.connection.subscribe(player);
        
        debugLog(`🔊 Playing detection sound: ${soundFile} (looping for target user)`);

        player.on(AudioPlayerStatus.Idle, () => {
            // If user is still speaking, play again
            if (session && session.enabled && session.isTargetSpeaking) {
                setTimeout(() => {
                    startSoundLoop(channelId, soundFile);
                }, 100); // Very short delay before repeating
            }
        });

        player.on('error', error => {
            console.error(`❌ Detection sound player error:`, error);
        });

    } catch (error) {
        console.error(`❌ Error playing detection sound:`, error);
    }
}

// Handle voice activity for target user
function handleVoiceActivity(channelId, userId, isSpeaking) {
    const session = voiceDetectionSessions.get(channelId);
    if (!session || !session.enabled || userId !== session.targetUserId) return;
    
    if (isSpeaking && !session.isTargetSpeaking) {
        // Target user started speaking
        session.isTargetSpeaking = true;
        debugLog(`🎯 Target user ${userId} started speaking - starting sound loop`);
        startSoundLoop(channelId, session.selectedSound);
    } else if (!isSpeaking && session.isTargetSpeaking) {
        // Target user stopped speaking
        session.isTargetSpeaking = false;
        debugLog(`🎯 Target user ${userId} stopped speaking - sound will stop after current playback`);
    }
}

// Start voice detection in a channel
async function startVoiceDetection(interaction, soundFile, targetUser) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        return interaction.reply({
            content: '❌ You need to be in a voice channel to start voice detection!',
            ephemeral: true
        });
    }

    // Check if target user is in the same voice channel
    if (!targetUser.voice.channel || targetUser.voice.channel.id !== voiceChannel.id) {
        return interaction.reply({
            content: `❌ ${targetUser.displayName} is not in your voice channel!`,
            ephemeral: true
        });
    }

    const soundPath = path.join(SOUNDS_DIR, soundFile);
    if (!fs.existsSync(soundPath)) {
        return interaction.reply({
            content: '❌ Sound file not found!',
            ephemeral: true
        });
    }

    try {
        await interaction.deferReply();

        // Stop any existing detection in this channel
        stopVoiceDetection(voiceChannel.id);

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        activeConnections.set(voiceChannel.id, connection);

        // Create receiver to listen for voice activity
        const receiver = connection.receiver;

        // Store voice detection session
        voiceDetectionSessions.set(voiceChannel.id, {
            enabled: true,
            selectedSound: soundFile,
            connection: connection,
            receiver: receiver,
            targetUserId: targetUser.id,
            isTargetSpeaking: false,
            soundLoop: null
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            debugLog(`🎧 Voice detection ready in ${voiceChannel.name} for user ${targetUser.displayName}`);
            
            // Listen for speaking events
            receiver.speaking.on('start', (userId) => {
                debugLog(`👤 User ${userId} started speaking`);
                handleVoiceActivity(voiceChannel.id, userId, true);
            });

            receiver.speaking.on('end', (userId) => {
                debugLog(`👤 User ${userId} stopped speaking`);
                handleVoiceActivity(voiceChannel.id, userId, false);
            });
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            debugLog(`🔌 Voice detection disconnected from ${voiceChannel.name}`);
            stopVoiceDetection(voiceChannel.id);
        });

        connection.on('error', error => {
            console.error(`❌ Voice detection connection error:`, error);
            stopVoiceDetection(voiceChannel.id);
        });

        const soundName = path.parse(soundFile).name;
        
        await interaction.editReply({
            content: `🎧 **Voice Detection Started!**\n\n🎯 **Target:** ${targetUser.displayName}\n🔊 **Sound:** **${soundName}**\n📍 **Channel:** ${voiceChannel.name}\n\n💡 The sound will play continuously while ${targetUser.displayName} is speaking!\n\nUse \`/stopsoundboard\` to stop voice detection.`
        });

    } catch (error) {
        console.error(`❌ Error starting voice detection:`, error);
        await interaction.editReply({
            content: '❌ Failed to start voice detection. Make sure I have permission to join your voice channel!'
        });
    }
}

// Play soundboard with repetition (regular soundboard function)
async function playSoundboard(interaction, soundFile, repeatCount = 1) {
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
        return interaction.reply({
            content: '❌ You need to be in a voice channel to use the soundboard!',
            ephemeral: true
        });
    }

    const soundPath = path.join(SOUNDS_DIR, soundFile);
    if (!fs.existsSync(soundPath)) {
        return interaction.reply({
            content: '❌ Sound file not found!',
            ephemeral: true
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
                // Finished all repetitions - disconnect after delay
                debugLog(`🎵 Audio finished all ${repeatCount} repetitions`);
                setTimeout(() => {
                    if (activeConnections.has(voiceChannel.id)) {
                        const conn = activeConnections.get(voiceChannel.id);
                        conn.destroy();
                        activeConnections.delete(voiceChannel.id);
                    }
                    stopSoundboardSession(voiceChannel.id);
                }, 2000);
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
            .setName('detectvoice')
            .setDescription('Start voice detection - plays selected sound while target person speaks')
            .addUserOption(option =>
                option
                    .setName('target')
                    .setDescription('Select the person to monitor')
                    .setRequired(true)
            )
            .addStringOption(option => {
                option
                    .setName('sound')
                    .setDescription('Choose a sound to play when they speak')
                    .setRequired(true);
                
                // Add sound choices
                if (sounds.length === 0) {
                    option.addChoices({ name: 'No sounds found', value: 'none' });
                } else {
                    sounds.slice(0, 25).forEach(sound => {
                        const cleanName = sound.name.length > 100 ? sound.name.substring(0, 97) + '...' : sound.name;
                        option.addChoices({ name: cleanName, value: sound.value });
                    });
                }
                
                return option;
            }),
        
        new SlashCommandBuilder()
            .setName('stopsoundboard')
            .setDescription('Stop current soundboard playback or voice detection'),
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
    log(`One Piece Voice Detection Bot is ready to set sail!`);
    log(`⚓ Logged in as ${client.user.tag}`);
    log(`🎵 Soundboard enabled with ${getAvailableSounds().length} sounds`);
    log(`🎧 Voice detection system ready!`);
    
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

    if (commandName === 'soundboard') {
        const soundFile = interaction.options.getString('sound');
        const repeatCount = interaction.options.getInteger('repeat') || 1;
        
        if (soundFile === 'none') {
            return interaction.reply({
                content: '❌ No sound files found! Add .ogg, .mp3, or .wav files to the sounds folder.',
                ephemeral: true
            });
        }
        
        await playSoundboard(interaction, soundFile, repeatCount);
    }
    
    else if (commandName === 'detectvoice') {
        const targetUser = interaction.options.getUser('target');
        const soundFile = interaction.options.getString('sound');
        
        if (soundFile === 'none') {
            return interaction.reply({
                content: '❌ No sound files found! Add .ogg, .mp3, or .wav files to the sounds folder.',
                ephemeral: true
            });
        }
        
        // Get the guild member from the user
        const targetMember = interaction.guild.members.cache.get(targetUser.id);
        if (!targetMember) {
            return interaction.reply({
                content: '❌ Could not find that user in this server!',
                ephemeral: true
            });
        }
        
        await startVoiceDetection(interaction, soundFile, targetMember);
    }
    
    else if (commandName === 'stopsoundboard') {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;
        
        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ You need to be in a voice channel!',
                ephemeral: true
            });
        }
        
        // Stop both soundboard and voice detection
        stopSoundboardSession(voiceChannel.id);
        stopVoiceDetection(voiceChannel.id);
        
        if (activeConnections.has(voiceChannel.id)) {
            const connection = activeConnections.get(voiceChannel.id);
            connection.destroy();
            activeConnections.delete(voiceChannel.id);
        }
        
        await interaction.reply({
            content: '🛑 Stopped all soundboard activities (playback and voice detection)!',
            ephemeral: true
        });
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
                
                // Stop any soundboard session and voice detection
                stopSoundboardSession(oldChannel.id);
                stopVoiceDetection(oldChannel.id);
                
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
    log('🛑 Shutting down bot...');
    
    // Clean up voice connections and soundboard sessions
    activeConnections.forEach(connection => connection.destroy());
    activeConnections.clear();
    
    soundboardSessions.forEach((session, channelId) => {
        stopSoundboardSession(channelId);
    });
    
    voiceDetectionSessions.forEach((session, channelId) => {
        stopVoiceDetection(channelId);
    });
    
    client.destroy();
    process.exit(0);
}

// Keep the process alive
setInterval(() => {
    if (DEBUG) {
        console.log(`🏴‍☠️ Bot alive - Connections: ${activeConnections.size}, Sessions: ${soundboardSessions.size}, Voice Detection: ${voiceDetectionSessions.size}`);
    }
}, 300000); // Log every 5 minutes in debug mode

// Start the bot
log('🚀 Starting One Piece Voice Detection Bot...');
log(`🔑 Token: ${DISCORD_TOKEN ? 'Provided' : 'MISSING'}`);
log(`🆔 Client ID: ${CLIENT_ID ? 'Provided' : 'MISSING'}`);

client.login(DISCORD_TOKEN).catch(error => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
});
