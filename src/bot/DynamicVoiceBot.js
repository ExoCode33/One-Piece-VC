const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../../config/config');
const { onePieceChannels } = require('../../config/channels');

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
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.client.once('ready', () => {
            console.log(`✅ Pirate Bot is ready! Logged in as ${this.client.user.tag} 🏴‍☠️`);
            console.log(`🔧 Debug mode: ${config.debug}`);
            console.log(`⚓ Create channel name: "${config.createChannelName}"`);
            this.setupGuilds();
        });

        this.client.on('voiceStateUpdate', (oldState, newState) => {
            console.log(`🎤 Voice state update detected!`);
            console.log(`Old channel: ${oldState.channel?.name || 'None'}`);
            console.log(`New channel: ${newState.channel?.name || 'None'}`);
            console.log(`User: ${newState.member?.user.tag || 'Unknown'}`);
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
            
            let category = guild.channels.cache.find(
                c => c.name === config.categoryName && c.type === ChannelType.GuildCategory
            );

            if (!category) {
                category = await guild.channels.create({
                    name: config.categoryName,
                    type: ChannelType.GuildCategory,
                });
                console.log(`📁 Created category: ${config.categoryName} 🏴‍☠️`);
            } else {
                console.log(`📁 Found existing category: ${config.categoryName}`);
            }

            let createChannel = guild.channels.cache.find(
                c => c.name === config.createChannelName && c.type === ChannelType.GuildVoice
            );

            if (!createChannel) {
                createChannel = await guild.channels.create({
                    name: config.createChannelName,
                    type: ChannelType.GuildVoice,
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
                        }
                    ]
                });
                console.log(`⚓ Created join channel: ${config.createChannelName}`);
            } else {
                console.log(`⚓ Found existing join channel: ${config.createChannelName}`);
            }

            // Debug: Check bot permissions
            const botMember = guild.members.cache.get(this.client.user.id);
            if (botMember) {
                const permissions = botMember.permissions;
                console.log(`🔑 Bot permissions in ${guild.name}:`);
                console.log(`  - Manage Channels: ${permissions.has(PermissionFlagsBits.ManageChannels)}`);
                console.log(`  - Connect: ${permissions.has(PermissionFlagsBits.Connect)}`);
                console.log(`  - Move Members: ${permissions.has(PermissionFlagsBits.MoveMembers)}`);
                console.log(`  - View Channels: ${permissions.has(PermissionFlagsBits.ViewChannels)}`);
            }

            await this.cleanupEmptyChannels(guild);

        } catch (error) {
            console.error(`❌ Error setting up guild ${guild.name}:`, error);
        }
    }

    async handleVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        
        if (newState.channel) {
            console.log(`📞 User joined channel: ${newState.channel.name}`);
            await this.handleChannelJoin(newState, guild);
        }

        if (oldState.channel) {
            console.log(`📴 User left channel: ${oldState.channel.name}`);
            await this.handleChannelLeave(oldState, guild);
        }
    }

    async handleChannelJoin(newState, guild) {
        const channel = newState.channel;
        console.log(`🔍 Checking if "${channel.name}" matches "${config.createChannelName}"`);
        
        if (channel.name === config.createChannelName) {
            console.log(`✅ Match found! Creating new voice channel for ${newState.member.user.tag}`);
            await this.createNewVoiceChannel(newState.member, guild, channel.parent);
        } else {
            console.log(`❌ No match. Channel: "${channel.name}" vs Expected: "${config.createChannelName}"`);
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

    async createNewVoiceChannel(member, guild, parentCategory) {
        try {
            console.log(`🚧 Starting to create new voice channel...`);
            
            // Check permissions again before creating
            const botMember = guild.members.cache.get(this.client.user.id);
            if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
                console.error(`❌ Bot missing Manage Channels permission!`);
                return;
            }

            const channelName = this.getRandomChannelName();
            console.log(`🎯 Selected channel name: ${channelName}`);
            
            const newChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                parent: parentCategory,
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

            console.log(`✅ Created channel: ${newChannel.name} (ID: ${newChannel.id})`);

            this.createdChannels.add(newChannel.id);
            
            console.log(`🚢 Moving ${member.user.tag} to ${newChannel.name}`);
            await member.voice.setChannel(newChannel);

            console.log(`🏴‍☠️ Created new pirate crew: ${channelName} for Captain ${member.user.tag}!`);

        } catch (error) {
            console.error(`❌ Error creating voice channel for ${member.user.tag}:`, error);
            console.error(`Error details:`, error.message);
        }
    }

    getRandomChannelName() {
        const availableNames = onePieceChannels.filter(name => !this.usedChannelNames.has(name));
        
        if (availableNames.length === 0) {
            console.log(`🔄 Resetting used channel names (all ${onePieceChannels.length} names were used)`);
            this.usedChannelNames.clear();
            availableNames.push(...onePieceChannels);
        }
        
        const randomName = availableNames[Math.floor(Math.random() * availableNames.length)];
        this.usedChannelNames.add(randomName);
        
        console.log(`🎲 Selected random name: ${randomName} (${availableNames.length} available)`);
        return randomName;
    }

    async cleanupEmptyChannels(guild) {
        const channels = guild.channels.cache.filter(
            c => c.type === ChannelType.GuildVoice && 
                onePieceChannels.includes(c.name) &&
                c.members.size === 0 &&
                c.name !== config.createChannelName
        );

        console.log(`🧹 Found ${channels.size} empty channels to cleanup`);

        for (const channel of channels.values()) {
            try {
                await channel.delete('Cleanup abandoned crew on startup 🏴‍☠️');
                console.log(`🧹 Cleaned up abandoned crew: ${channel.name}`);
            } catch (error) {
                console.error(`❌ Error cleaning up channel ${channel.name}:`, error);
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
        
        for (const timer of this.deleteTimers.values()) {
            clearTimeout(timer);
        }
        
        await this.client.destroy();
    }
}

module.exports = DynamicVoiceBot;
