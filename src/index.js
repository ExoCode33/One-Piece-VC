const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Import AFK Manager
const AFKManager = require('./afkManager');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Initialize AFK Manager
let afkManager;

// One Piece themed channel names
const piratePlaces = [
    "🏴‍☠️ Going Merry",
    "⛵ Thousand Sunny", 
    "🏝️ Laugh Tale",
    "🌊 Water 7",
    "🌸 Wano Country",
    "🐠 Fish-Man Island",
    "☁️ Skypiea",
    "🏜️ Alabasta",
    "❄️ Drum Island",
    "🌺 Amazon Lily",
    "⚡ Enel's Ship",
    "🔥 Ace's Striker",
    "⚓ Marine Ship",
    "🏛️ Enies Lobby",
    "🌪️ Thriller Bark",
    "🗿 Jaya Island",
    "🦅 Bird Kingdom",
    "🐉 Punk Hazard",
    "🍭 Whole Cake Island",
    "⚔️ Dressrosa",
    "🌋 Marineford",
    "🏰 Impel Down",
    "🦈 Arlong Park",
    "🎪 Buggy's Ship",
    "⭐ Baratie Restaurant",
    "🍊 Cocoyasi Village",
    "🏝️ Little Garden",
    "🌙 Ohara Island",
    "🎭 Mock Town",
    "🏔️ Reverse Mountain"
];

const createdChannels = new Set();

client.once('ready', () => {
    console.log('🏴‍☠️ One Piece Voice Bot is ready to set sail!');
    console.log(`⚓ Logged in as ${client.user.tag}`);
    
    // Initialize AFK Manager
    afkManager = new AFKManager(client);
    
    // Log AFK settings
    const stats = afkManager.getAFKStats();
    console.log(`🕒 AFK Timeout: ${stats.timeout} minutes`);
    console.log(`🛡️ Protected channels: ${stats.excludedChannels.join(', ')}`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    const createChannelName = process.env.CREATE_CHANNEL_NAME || '🏴‍☠️ Set Sail Together';
    const categoryName = process.env.CATEGORY_NAME || '🌊 Grand Line Voice Channels';
    const deleteDelay = parseInt(process.env.DELETE_DELAY) || 5000;

    // User joined the "Set Sail Together" channel
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

            // Get random pirate place name
            const placeName = piratePlaces[Math.floor(Math.random() * piratePlaces.length)];
            
            // Create new voice channel
            const newChannel = await guild.channels.create({
                name: placeName,
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
            createdChannels.add(newChannel.id);

            // Send welcome message
            const generalChannel = guild.channels.cache.find(ch => 
                ch.type === ChannelType.GuildText && (ch.name.includes('general') || ch.name.includes('chat'))
            );
            
            if (generalChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B35')
                    .setTitle('🏴‍☠️ New Crew Assembled!')
                    .setDescription(`**${member.displayName}** has formed a new crew at **${placeName}**!`)
                    .addFields(
                        { name: '👑 Captain', value: member.displayName, inline: true },
                        { name: '🚢 Ship', value: placeName, inline: true }
                    )
                    .setFooter({ text: 'Join them on their adventure!' })
                    .setTimestamp();

                await generalChannel.send({ embeds: [embed] });
            }

            console.log(`🚢 Created new crew: ${placeName} for ${member.displayName}`);

            // Play random sound effect if sounds folder exists
            const soundsPath = path.join(__dirname, '..', 'sounds');
            if (fs.existsSync(soundsPath)) {
                try {
                    const soundFiles = fs.readdirSync(soundsPath).filter(file => 
                        file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.ogg')
                    );
                    
                    if (soundFiles.length > 0) {
                        const randomSound = soundFiles[Math.floor(Math.random() * soundFiles.length)];
                        const soundPath = path.join(soundsPath, randomSound);
                        
                        const connection = joinVoiceChannel({
                            channelId: newChannel.id,
                            guildId: guild.id,
                            adapterCreator: guild.voiceAdapterCreator,
                        });

                        const player = createAudioPlayer();
                        const resource = createAudioResource(soundPath);
                        
                        player.play(resource);
                        connection.subscribe(player);

                        player.on(AudioPlayerStatus.Idle, () => {
                            connection.destroy();
                        });

                        setTimeout(() => {
                            if (connection.state.status !== 'destroyed') {
                                connection.destroy();
                            }
                        }, 10000); // Disconnect after 10 seconds max
                    }
                } catch (soundError) {
                    console.error('🔊 Sound effect error:', soundError);
                }
            }

        } catch (error) {
            console.error('❌ Error creating channel:', error);
        }
    }

    // Check if a created channel is empty and should be deleted
    if (oldState.channel && createdChannels.has(oldState.channel.id)) {
        setTimeout(async () => {
            try {
                const channel = oldState.channel;
                if (channel && channel.members.size === 0) {
                    console.log(`🗑️ Disbanding empty crew: ${channel.name}`);
                    createdChannels.delete(channel.id);
                    await channel.delete();
                    
                    // Send dissolution message
                    const guild = channel.guild;
                    const generalChannel = guild.channels.cache.find(ch => 
                        ch.type === ChannelType.GuildText && (ch.name.includes('general') || ch.name.includes('chat'))
                    );
                    
                    if (generalChannel) {
                        const embed = new EmbedBuilder()
                            .setColor('#6B73FF')
                            .setTitle('⚓ Crew Disbanded')
                            .setDescription(`The crew at **${channel.name}** has disbanded and returned to port.`)
                            .setFooter({ text: 'Set sail again anytime!' })
                            .setTimestamp();

                        await generalChannel.send({ embeds: [embed] });
                    }
                }
            } catch (error) {
                console.error('❌ Error deleting channel:', error);
            }
        }, deleteDelay);
    }
});

// Command to check AFK stats (for debugging)
client.on('messageCreate', async (message) => {
    if (message.content === '!afkstats' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        if (!afkManager) {
            return message.reply('❌ AFK Manager not initialized');
        }
        
        const stats = afkManager.getAFKStats();
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('📊 AFK Manager Statistics')
            .addFields(
                { name: '👥 Tracked Users', value: stats.totalTracked.toString(), inline: true },
                { name: '💤 Currently AFK', value: stats.currentlyAFK.toString(), inline: true },
                { name: '⏰ Timeout', value: `${stats.timeout} minutes`, inline: true },
                { name: '🛡️ Protected Channels', value: stats.excludedChannels.join('\n') || 'None', inline: false }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
});

// Error handling
client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);
