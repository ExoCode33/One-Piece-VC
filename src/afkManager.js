// src/afkManager.js
const { EmbedBuilder } = require('discord.js');

class AFKManager {
    constructor(client) {
        this.client = client;
        this.afkUsers = new Map(); // userId -> { channelId, startTime, isAfk }
        this.checkInterval = 60000; // Check every minute
        
        // Configuration from environment variables
        this.afkTimeout = parseInt(process.env.AFK_TIMEOUT) || 900000; // 15 minutes default
        this.excludedChannels = process.env.AFK_EXCLUDED_CHANNELS ? 
            process.env.AFK_EXCLUDED_CHANNELS.split(',').map(name => name.trim()) : 
            ['🎵 Lofi/Chill', '🌙 Rest Area'];
        
        this.onePieceDisconnectMessages = [
            "🌊 {user} got swept away by the Grand Line currents!",
            "💤 {user} fell asleep like Zoro during navigation...",
            "🏃 {user} ran away from the Marines!",
            "🍖 {user} went hunting for Sea King meat!",
            "⚓ {user} got lost like Zoro (auto-disconnected)",
            "🌪️ {user} was caught in a sudden storm!",
            "🏝️ {user} went exploring a mysterious island!",
            "🎣 {user} went fishing with Usopp!",
            "🍺 {user} passed out from too much sake!",
            "📚 {user} fell asleep reading poneglyphs with Robin...",
            "🎵 {user} drifted away listening to Brook's music!",
            "⚡ {user} was struck by Enel's lightning!",
            "🌸 {user} got distracted by cherry blossoms in Wano!",
            "🐟 {user} went swimming with the Fish-Men!",
            "🔥 {user} got too close to Ace's flames!"
        ];
        
        this.startAFKMonitoring();
    }

    startAFKMonitoring() {
        console.log('🏴‍☠️ AFK Manager: Started monitoring for inactive pirates...');
        console.log(`⏰ AFK Timeout: ${this.afkTimeout / 60000} minutes`);
        console.log(`🛡️ Protected Channels: ${this.excludedChannels.join(', ')}`);
        
        // Monitor voice state changes
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            this.handleVoiceStateUpdate(oldState, newState);
        });
        
        // Check for AFK users periodically
        setInterval(() => {
            this.checkAFKUsers();
        }, this.checkInterval);
    }

    handleVoiceStateUpdate(oldState, newState) {
        const userId = newState.member.id;
        
        // User joined a voice channel
        if (!oldState.channel && newState.channel) {
            this.trackUser(userId, newState.channel.id, false);
        }
        
        // User left voice channel
        else if (oldState.channel && !newState.channel) {
            this.stopTracking(userId);
        }
        
        // User moved between channels
        else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            this.trackUser(userId, newState.channel.id, false);
        }
        
        // User's state changed (muted/deafened)
        else if (newState.channel) {
            const wasAfk = this.isUserAFK(oldState);
            const isAfk = this.isUserAFK(newState);
            
            if (wasAfk !== isAfk) {
                this.updateUserAFKStatus(userId, newState.channel.id, isAfk);
            }
        }
    }

    isUserAFK(voiceState) {
        // Consider user AFK if they are self-deafened or self-muted
        return voiceState.selfDeaf || voiceState.selfMute;
    }

    trackUser(userId, channelId, isAfk) {
        this.afkUsers.set(userId, {
            channelId: channelId,
            startTime: isAfk ? Date.now() : null,
            isAfk: isAfk
        });
        
        if (process.env.DEBUG === 'true') {
            console.log(`👁️ Now tracking user ${userId} in channel ${channelId} (AFK: ${isAfk})`);
        }
    }

    updateUserAFKStatus(userId, channelId, isAfk) {
        const userData = this.afkUsers.get(userId);
        if (userData) {
            userData.channelId = channelId;
            userData.isAfk = isAfk;
            userData.startTime = isAfk ? Date.now() : null;
            
            if (process.env.DEBUG === 'true') {
                console.log(`🔄 Updated AFK status for user ${userId}: ${isAfk ? 'AFK' : 'Active'}`);
            }
        }
    }

    stopTracking(userId) {
        this.afkUsers.delete(userId);
        if (process.env.DEBUG === 'true') {
            console.log(`👋 Stopped tracking user ${userId}`);
        }
    }

    async checkAFKUsers() {
        const now = Date.now();
        const usersToDisconnect = [];

        for (const [userId, userData] of this.afkUsers.entries()) {
            if (!userData.isAfk || !userData.startTime) continue;

            const afkDuration = now - userData.startTime;
            
            if (afkDuration >= this.afkTimeout) {
                try {
                    const guild = this.client.guilds.cache.first(); // Assuming single guild
                    const member = await guild.members.fetch(userId);
                    const channel = guild.channels.cache.get(userData.channelId);
                    
                    if (member && member.voice.channel && channel) {
                        // Check if user is in an excluded channel
                        if (this.isChannelExcluded(channel.name)) {
                            if (process.env.DEBUG === 'true') {
                                console.log(`🛡️ User ${member.displayName} is in protected channel: ${channel.name}`);
                            }
                            continue;
                        }
                        
                        usersToDisconnect.push({ member, channel, afkDuration });
                    }
                } catch (error) {
                    console.error(`❌ Error checking user ${userId}:`, error);
                    this.stopTracking(userId);
                }
            }
        }

        // Disconnect AFK users
        for (const { member, channel, afkDuration } of usersToDisconnect) {
            await this.disconnectAFKUser(member, channel, afkDuration);
        }
    }

    isChannelExcluded(channelName) {
        return this.excludedChannels.some(excludedName => 
            channelName.toLowerCase().includes(excludedName.toLowerCase()) ||
            excludedName.toLowerCase().includes(channelName.toLowerCase())
        );
    }

    async disconnectAFKUser(member, channel, afkDuration) {
        try {
            // Disconnect the user
            await member.voice.disconnect('AFK timeout');
            this.stopTracking(member.id);
            
            // Get random disconnect message
            const randomMessage = this.onePieceDisconnectMessages[
                Math.floor(Math.random() * this.onePieceDisconnectMessages.length)
            ].replace('{user}', member.displayName);
            
            // Send notification to the channel they were in (if it's a text channel available)
            const guild = member.guild;
            const generalChannel = guild.channels.cache.find(ch => 
                ch.type === 0 && (ch.name.includes('general') || ch.name.includes('chat'))
            );
            
            if (generalChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('⚓ Crew Member Lost at Sea!')
                    .setDescription(randomMessage)
                    .addFields(
                        { name: '🏴‍☠️ Former Location', value: channel.name, inline: true },
                        { name: '⏰ AFK Duration', value: `${Math.floor(afkDuration / 60000)} minutes`, inline: true }
                    )
                    .setFooter({ text: 'Return when you\'re ready to set sail again!' })
                    .setTimestamp();

                await generalChannel.send({ embeds: [embed] });
            }
            
            console.log(`🌊 Disconnected AFK user: ${member.displayName} from ${channel.name} (AFK for ${Math.floor(afkDuration / 60000)} minutes)`);
            
        } catch (error) {
            console.error(`❌ Error disconnecting user ${member.displayName}:`, error);
        }
    }

    // Method to get current AFK statistics
    getAFKStats() {
        const totalTracked = this.afkUsers.size;
        const currentlyAFK = Array.from(this.afkUsers.values()).filter(user => user.isAfk).length;
        
        return {
            totalTracked,
            currentlyAFK,
            timeout: this.afkTimeout / 60000, // in minutes
            excludedChannels: this.excludedChannels
        };
    }

    // Method to manually check a specific user
    async checkUser(userId) {
        const userData = this.afkUsers.get(userId);
        if (!userData) return null;
        
        return {
            isAfk: userData.isAfk,
            afkDuration: userData.startTime ? Date.now() - userData.startTime : 0,
            channelId: userData.channelId
        };
    }
}

module.exports = AFKManager;
