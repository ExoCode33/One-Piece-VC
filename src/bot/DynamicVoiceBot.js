async function playAudio(channel, member) {
    console.log(`🎵 playAudio() called for channel: ${channel.name}`);
    
    try {
        // Check if audio file exists
        if (!fs.existsSync(audioFilePath)) {
            console.error('❌ Audio file not found, cannot play audio');
            return;
        }

        console.log(`🔌 Joining voice channel: ${channel.name}`);

        // Create voice connection
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        // Store connection
        const connectionKey = `${channel.guild.id}-${channel.id}`;
        voiceConnections.set(connectionKey, connection);
        console.log(`💾 Stored voice connection with key: ${connectionKey}`);

        // Create a cleanup function to avoid duplication
        const cleanupConnection = (reason = 'unknown') => {
            console.log(`🧹 Cleaning up connection for ${channel.name} (reason: ${reason})`);
            
            try {
                // Stop audio player first
                if (audioPlayers.has(connectionKey)) {
                    const player = audioPlayers.get(connectionKey);
                    player.stop();
                    audioPlayers.delete(connectionKey);
                    console.log(`🎵 Audio player stopped and removed`);
                }

                // Destroy voice connection
                if (voiceConnections.has(connectionKey)) {
                    const conn = voiceConnections.get(connectionKey);
                    if (conn.state.status !== VoiceConnectionStatus.Destroyed) {
                        conn.destroy();
                        console.log(`🔌 Voice connection destroyed`);
                    }
                    voiceConnections.delete(connectionKey);
                }
                
                console.log(`✅ Cleanup completed for ${channel.name}`);
            } catch (error) {
                console.error('❌ Error during cleanup:', error);
            }
        };

        // Set up the guaranteed disconnect timer FIRST
        const forceDisconnectTimer = setTimeout(() => {
            console.log(`⏰ 7 seconds elapsed, forcing disconnect from ${channel.name}`);
            cleanupConnection('7-second-timeout');
        }, 7000);

        // Handle connection events
        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('✅ Voice connection is ready!');
            
            try {
                // Create audio player and resource
                console.log(`🎼 Creating audio player and resource...`);
                const player = createAudioPlayer();
                const resource = createAudioResource(audioFilePath, {
                    inlineVolume: true
                });
                
                // Set volume
                resource.volume.setVolume(0.5);
                console.log(`🔊 Volume set to 50%`);
                
                // Store player
                audioPlayers.set(connectionKey, player);

                // Play the audio
                console.log(`▶️ Starting audio playback...`);
                player.play(resource);
                connection.subscribe(player);

                // Handle player events
                player.on(AudioPlayerStatus.Playing, () => {
                    console.log(`🎵 ✅ Audio is now playing in ${channel.name}!`);
                });

                player.on(AudioPlayerStatus.Idle, () => {
                    console.log(`🎵 Audio finished playing in ${channel.name}`);
                    
                    // Clear the force disconnect timer since we're handling it now
                    clearTimeout(forceDisconnectTimer);
                    
                    // Small delay to ensure audio finished cleanly, then disconnect
                    setTimeout(() => {
                        cleanupConnection('audio-finished');
                    }, 1000);
                });

                player.on('error', error => {
                    console.error('❌ Audio player error:', error);
                    
                    // Clear the force disconnect timer
                    clearTimeout(forceDisconnectTimer);
                    
                    // Cleanup on error
                    setTimeout(() => {
                        cleanupConnection('audio-error');
                    }, 500);
                });

            } catch (audioError) {
                console.error('❌ Error setting up audio:', audioError);
                
                // Clear the force disconnect timer
                clearTimeout(forceDisconnectTimer);
                
                // Clean up on setup error
                setTimeout(() => {
                    cleanupConnection('setup-error');
                }, 500);
            }
        });

        connection.on(VoiceConnectionStatus.Connecting, () => {
            console.log('🔄 Connecting to voice channel...');
        });

        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log(`🔌 Disconnected from voice channel: ${channel.name}`);
            
            // Clear the force disconnect timer
            clearTimeout(forceDisconnectTimer);
            
            // Clean up when disconnected
            cleanupConnection('connection-disconnected');
        });

        connection.on('error', error => {
            console.error('❌ Voice connection error:', error);
            
            // Clear the force disconnect timer
            clearTimeout(forceDisconnectTimer);
            
            // Clean up on connection error
            setTimeout(() => {
                cleanupConnection('connection-error');
            }, 500);
        });

    } catch (error) {
        console.error('❌ Error in playAudio function:', error);
    }
}
