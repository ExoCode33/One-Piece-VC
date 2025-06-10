const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../../config/config');
const { onePieceChannels } = require('../../config/channels');

// Try to import voice module
let voiceModule = null;

try {
    voiceModule = require('@discordjs/voice');
    console.log('🎵 Voice module loaded successfully!');
} catch (error) {
    console.log('⚠️ Voice module not available, running without audio');
}

class DynamicVoiceBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates
            ]
        });
        
        this.createdChannels = new Set();
        this.deleteTimers = new Map();
        this.usedChannelNames = new Set();
        this.audioConnections = new Map();
        this.hasVoiceSupport = !!voiceModule;
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.client.once('ready', () => {
            console.log(`✅ Pirate Bot is ready! Logged in as ${this.client.user.tag} 🏴‍☠️`);
            console.log(`⚓ Create channel name: "${config.createChannelName}"`);
            console.log(`🎵 Audio support: ${this.hasVoiceSupport ? 'ENABLED' : 'DISABLED'}`);
            this.setupGuilds();
        });

        this.client.on('voiceStateUpdate', (oldState, newState) => {
            console.log(`🎤 Voice state update: ${newState.member?.user.tag || 'Unknown'}`);
            console.log(`📞 Joined: ${newState.channel?.name || 'None'} | Left: ${oldState.channel?.name || 'None'}`);
            this.handleVoiceStateUpdate(oldState, newState);
        });

        this.client.on('error', console.error);
    }

    async setupGuilds() {
        for (const guild of this.client.guilds.cache.values()) {
            await this.setupGuild(guild);
        }
    }

    async setupGuild(guild) {
        try {
            console.log(`🏗️ Setting up guild: ${guild.name}`);
            
            // Find the Community category
            const communityCategory = guild.channels.cache.find(
                c => c.name === '✦✗✦ Community ✦✗✦' && c.type === ChannelType.GuildCategory
            );
            
            if (!communityCategory) {
                console.log(`⚠️ Could not find "✦✗✦ Community ✦✗✦" category`);
            } else {
                console.log(`📁 Found Community category: ${communityCategory.name}`);
            }
            
            // Check if join channel already exists
            let createChannel = guild.channels.cache.find(
                c => c.name === config.createChannelName && c.type === ChannelType.GuildVoice
            );

            if (!createChannel) {
                createChannel = await guild.channels.create({
                    name: config.createChannelName,
                    type: ChannelType.GuildVoice,
                    parent: communityCategory?.id,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                        }
                    ]
                });
                console.log(`⚓ Created new join channel: ${config.createChannelName}`);
            } else {
                console.log(`⚓ Using existing join channel: ${config.createChannelName}`);
            }

            await this.cleanupEmptyChannels(guild);
            console.log(`✅ Guild setup complete for: ${guild.name}`);

        } catch (error) {
            console.error(`❌ Error setting up guild ${guild.name}:`, error);
        }
    }

    async handleVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        
        if (newState.channel) {
            await this.handleChannelJoin(newState, guild);
        }

        if (oldState.channel) {
            await this.handleChannelLeave(oldState, guild);
        }
    }

    async handleChannelJoin(newState, guild) {
        const channel = newState.channel;
        
        if (channel.name === config.createChannelName) {
            console.log(`🚢 AHOY! ${newState.member.user.tag} joined the crew recruitment channel!`);
            
            // Create new voice channel FIRST, then move user, THEN play sound
            await this.createNewVoiceChannel(newState.member, guild);
        }

        if (this.deleteTimers.has(channel.id)) {
            clearTimeout(this.deleteTimers.get(channel.id));
            this.deleteTimers.delete(channel.id);
            console.log(`⏸️ Cancelled disbanding ${channel.name} - new crew member joined!`);
        }
    }

    async handleChannelLeave(oldState, guild) {
        const channel = oldState.channel;
        
        if (this.createdChannels.has(channel.id) && channel.members.size === 0) {
            const timer = setTimeout(async () => {
                try {
                    const currentChannel = guild.channels.cache.get(channel.id);
                    if (currentChannel && currentChannel.members.size === 0) {
                        await currentChannel.delete('Crew disbanded - setting sail elsewhere 🌊');
                        this.createdChannels.delete(channel.id);
                        this.usedChannelNames.delete(channel.name);
                        console.log(`🌊 Disbanded empty crew: ${channel.name}`);
                    }
                } catch (error) {
                    console.error(`❌ Error deleting channel ${channel.name}:`, error);
                }
                this.deleteTimers.delete(channel.id);
            }, config.deleteDelay);

            this.deleteTimers.set(channel.id, timer);
            console.log(`⏰ Crew ${channel.name} will disband in ${config.deleteDelay/1000}s if no one joins`);
        }
    }

    async playJoinSound(channel, guild) {
        if (!this.hasVoiceSupport || !voiceModule) {
            console.log(`🎵 *The Going Merry bell rings welcoming the new crew* 🔔⚓`);
            return;
        }

        try {
            console.log(`🎵 Playing The Going Merry welcome sound in ${channel.name}...`);
            
            const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = voiceModule;
            
            // Join the voice channel
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
            });

            const connectionKey = `${guild.id}-${channel.id}`;
            this.audioConnections.set(connectionKey, connection);

            // Set a simple timer - play for 10 seconds then disconnect
            console.log(`🎤 Bot joining ${channel.name} to play Going Merry sound! ⚓`);
            
            // Wait for connection to be ready
            connection.on(VoiceConnectionStatus.Ready, async () => {
                console.log(`🎤 Bot connected! Playing Going Merry sound... 🚢`);
                
                try {
                    // Create a simple audio player
                    const player = createAudioPlayer();
                    
                    // Try to create audio resource without FFmpeg
                    const resource = createAudioResource('./sounds/The Going Merry One Piece - Cut.mp3');
                    
                    // Subscribe player to connection
                    connection.subscribe(player);
                    
                    // Play the audio
                    player.play(resource);
                    console.log(`🎶 🚢 Going Merry sound is playing! ⚓`);
                    
                    // Set a fixed duration (10 seconds) then disconnect
                    setTimeout(() => {
                        console.log(`🎵 Going Merry sound playback complete!`);
                        if (this.audioConnections.has(connectionKey)) {
                            connection.destroy();
                            this.audioConnections.delete(connectionKey);
                            console.log(`⚓ Disconnected from ${channel.name} after playing sound`);
                        }
                    }, 10000); // 10 seconds
                    
                } catch (audioError) {
                    console.log(`⚠️ Audio error: ${audioError.message}`);
                    console.log(`🎵 *Fallback: The Going Merry bell rings* 🔔⚓`);
                    
                    // Disconnect after 3 seconds if audio fails
                    setTimeout(() => {
                        if (this.audioConnections.has(connectionKey)) {
                            connection.destroy();
                            this.audioConnections.delete(connectionKey);
                            console.log(`⚓ Disconnected after audio error`);
                        }
                    }, 3000);
                }
            });

            // Handle connection errors
            connection.on('error', (error) => {
                console.error(`🎤 Connection error: ${error.message}`);
                if (this.audioConnections.has(connectionKey)) {
                    this.audioConnections.delete(connectionKey);
                }
            });

            // Handle unexpected disconnections
            connection.on(VoiceConnectionStatus.Disconnected, () => {
                console.log(`🎤 Connection lost to ${channel.name}`);
                if (this.audioConnections.has(connectionKey)) {
                    this.audioConnections.delete(connectionKey);
                }
            });

        } catch (error) {
            console.log(`⚠️ Could not join voice channel: ${error.message}`);
            console.log(`🎵 *Fallback: The Going Merry bell rings across the seas* 🔔⚓`);
        }
    }

    async createNewVoiceChannel(member, guild) {
        try {
            console.log(`🚧 Creating new pirate crew for ${member.user.tag}...`);
            
            const channelName = this.getRandomChannelName();
            console.log(`🎯 Selected destination: ${channelName}`);
            
            // Find the join channel for positioning
            const joinChannel = guild.channels.cache.find(
                c => c.name === config.createChannelName && c.type === ChannelType.GuildVoice
            );
            
            // Find the Community category for proper placement
            const communityCategory = guild.channels.cache.find(
                c => c.name === '✦✗✦ Community ✦✗✦' && c.type === ChannelType.GuildCategory
            );
            
            // Try creating in category first, fallback to no category if permission denied
            let newChannel;
            try {
                newChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildVoice,
                    parent: communityCategory?.id,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                        },
                        {
                            id: member.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.MoveMembers
                            ]
                        }
                    ]
                });
                console.log(`📁 Created ${channelName} in Community category`);
            } catch (categoryError) {
                console.log(`⚠️ Cannot create in Community category, trying without category...`);
                newChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildVoice,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                        },
                        {
                            id: member.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.Connect,
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.MoveMembers
                            ]
                        }
                    ]
                });
                console.log(`📁 Created ${channelName} in main channel list (fallback)`);
            }

            // Position the channel right below the join channel
            if (joinChannel) {
                try {
                    await newChannel.setPosition(joinChannel.position + 1);
                    console.log(`📍 Positioned ${channelName} right below ${joinChannel.name}`);
                } catch (posError) {
                    console.log(`⚠️ Could not set position: ${posError.message}`);
                }
            }

            this.createdChannels.add(newChannel.id);
            
            console.log(`🚢 Moving Captain ${member.user.tag} to ${channelName}`);
            await member.voice.setChannel(newChannel);

            console.log(`🏴‍☠️ NEW PIRATE CREW FORMED: ${channelName} - Captain ${member.user.tag}! ⚓`);

            // NOW play the welcome sound in the NEW channel and WAIT for it to finish
            setTimeout(async () => {
                await this.playJoinSound(newChannel, guild);
            }, 1000); // 1 second delay to ensure user is moved

        } catch (error) {
            console.error(`❌ Failed to create pirate crew for ${member.user.tag}:`, error);
            console.error(`Error details:`, error.message);
        }
    }

    getRandomChannelName() {
        const availableNames = onePieceChannels.filter(name => !this.usedChannelNames.has(name));
        
        if (availableNames.length === 0) {
            console.log(`🔄 All ${onePieceChannels.length} One Piece locations visited! Resetting the Grand Line...`);
            this.usedChannelNames.clear();
            availableNames.push(...onePieceChannels);
        }
        
        const randomName = availableNames[Math.floor(Math.random() * availableNames.length)];
        this.usedChannelNames.add(randomName);
        
        return randomName;
    }

    async cleanupEmptyChannels(guild) {
        const channels = guild.channels.cache.filter(
            c => c.type === ChannelType.GuildVoice && 
                onePieceChannels.includes(c.name) &&
                c.members.size === 0 &&
                c.name !== config.createChannelName
        );

        if (channels.size > 0) {
            console.log(`🧹 Cleaning up ${channels.size} abandoned pirate ships...`);
        }

        for (const channel of channels.values()) {
            try {
                await channel.delete('Cleanup abandoned crew on startup 🏴‍☠️');
                console.log(`🧹 Cleaned up: ${channel.name}`);
            } catch (error) {
                console.error(`❌ Error cleaning up ${channel.name}:`, error);
            }
        }
    }

    async start() {
        try {
            await this.client.login(config.token);
        } catch (error) {
            console.error('❌ Failed to login:', error);
            process.exit(1);
        }
    }

    async stop() {
        console.log('🛑 The pirate crew is disbanding...');
        
        // Clear all timers
        for (const timer of this.deleteTimers.values()) {
            clearTimeout(timer);
        }
        
        // Disconnect from all voice channels
        for (const connection of this.audioConnections.values()) {
            connection.destroy();
        }
        this.audioConnections.clear();
        
        await this.client.destroy();
    }
}

module.exports = DynamicVoiceBot;
