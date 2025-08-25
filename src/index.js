// index.js
// Discord.js v14 dynamic voice channel manager (duplicate-proof)
// --------------------------------------------------------------

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
} = require('@discordjs/voice');

// ====== ENV ======
const TOKEN = process.env.DISCORD_TOKEN;
const CREATE_CHANNEL_ID = process.env.CREATE_CHANNEL_ID; // REQUIRED: "🏴〢Set Sail Together"
const VOICE_CATEGORY_ID = process.env.VOICE_CATEGORY_ID || null; // optional; will fall back to the create channel's parent
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null; // optional log channel
const WELCOME_SOUND_PATH = process.env.WELCOME_SOUND_PATH || null;
const DELETE_DELAY = Number(process.env.DELETE_DELAY_MS || 1500);
const DEBUG = String(process.env.DEBUG_VC || 'true').toLowerCase() !== 'false';

if (!TOKEN) throw new Error('Missing DISCORD_TOKEN');
if (!CREATE_CHANNEL_ID) throw new Error('Missing CREATE_CHANNEL_ID');

// ====== CLIENT ======
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.GuildMember, Partials.User],
});

// ====== STATE ======
// Prevent concurrent "create" work per user
const creatingForUser = new Set();              // userId -> boolean
// Cache user's active crew VC
const userCrew = new Map();                     // userId -> channelId
// One delete timer per channel
const deleteTimers = new Map();                 // channelId -> Timeout
// Track audio connections by channel (for welcome sound cleanup)
const activeConnections = new Map();            // channelId -> voice connection

// ====== LOGGING HELPERS ======
function log(msg) {
  console.log(msg);
}
function debugLog(msg) {
  if (DEBUG) console.log('[DEBUG]', msg);
}

async function sendVoiceLog(guild, type, member, channel) {
  try {
    if (!LOG_CHANNEL_ID) return;
    const logCh = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logCh) return;

    const color =
      type === 'JOIN' ? 0x2ecc71 :
      type === 'MOVE' ? 0xf1c40f :
      type === 'LEAVE' ? 0xe74c3c : 0x95a5a6;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${member.user.tag}`, iconURL: member.user.displayAvatarURL() })
      .setTitle(`🎤 ${type}`)
      .addFields(
        { name: 'User', value: `<@${member.id}>`, inline: true },
        { name: 'Channel', value: channel ? `${channel.name}` : '—', inline: true },
      )
      .setTimestamp(new Date());

    await logCh.send({ embeds: [embed] });
  } catch (e) {
    console.error('Failed to send voice log:', e);
  }
}

// ====== CATEGORY RESOLUTION ======
async function resolveVoiceCategoryId(guild) {
  if (VOICE_CATEGORY_ID) return VOICE_CATEGORY_ID;
  const createCh = guild.channels.cache.get(CREATE_CHANNEL_ID);
  if (createCh && createCh.parentId) {
    debugLog(`✅ Using parent category of create channel: ${createCh.parentId}`);
    return createCh.parentId;
  }
  throw new Error('Could not resolve voice category (set VOICE_CATEGORY_ID or ensure create channel has a parent).');
}

// ====== WELCOME SOUND ======
async function playWelcomeIfConfigured(channel) {
  try {
    if (!WELCOME_SOUND_PATH) return;
    if (!channel || channel.type !== ChannelType.GuildVoice) return;

    // Avoid stacking multiple connections
    if (activeConnections.has(channel.id)) {
      const existing = activeConnections.get(channel.id);
      try { existing.destroy(); } catch {}
      activeConnections.delete(channel.id);
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    activeConnections.set(channel.id, connection);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    const resource = createAudioResource(WELCOME_SOUND_PATH);

    connection.subscribe(player);
    player.play(resource);

    player.once(AudioPlayerStatus.Idle, () => {
      try {
        connection.destroy();
      } catch {}
      activeConnections.delete(channel.id);
      debugLog(`🎵 Welcome sound finished, left ${channel.name}`);
    });

    debugLog(`🎵 Playing welcome sound in ${channel.name}...`);
  } catch (e) {
    console.error('Welcome sound error:', e);
  }
}

// ====== CREATE HANDLER (find-or-create, user-locked) ======
async function handleCreateRequest(guild, member) {
  const categoryId = await resolveVoiceCategoryId(guild);

  if (creatingForUser.has(member.id)) {
    debugLog(`⏳ Create in progress for ${member.displayName}, ignoring duplicate event.`);
    return;
  }
  creatingForUser.add(member.id);

  try {
    // 1) Check cache
    const cachedId = userCrew.get(member.id);
    if (cachedId) {
      const cached = guild.channels.cache.get(cachedId);
      if (cached && cached.type === ChannelType.GuildVoice) {
        debugLog(`♻️ Reusing cached crew VC for ${member.displayName}: ${cached.name}`);
        if (member.voice?.channelId !== cached.id) {
          await member.voice.setChannel(cached, 'Reusing existing crew VC (cached)');
          await sendVoiceLog(guild, 'MOVE', member, cached);
        }
        return;
      } else {
        userCrew.delete(member.id);
      }
    }

    // 2) Try to find existing by deterministic name
    const crewName = getCrewName(member); // customize if you use per-user naming
    let existing = guild.channels.cache.find(
      c =>
        c &&
        c.type === ChannelType.GuildVoice &&
        c.parentId === categoryId &&
        c.name === crewName
    );

    if (existing) {
      debugLog(`🔎 Found pre-existing crew VC for ${member.displayName}: ${existing.name}`);
      userCrew.set(member.id, existing.id);
      if (member.voice?.channelId !== existing.id) {
        await member.voice.setChannel(existing, 'Reusing existing crew VC (found)');
        await sendVoiceLog(guild, 'MOVE', member, existing);
      }
      return;
    }

    // 3) Create new voice channel
    const channel = await guild.channels.create({
      name: crewName,
      type: ChannelType.GuildVoice,
      parent: categoryId,
      reason: `Crew VC for ${member.user.tag}`,
    });

    // Sync permissions from parent, then grant "captain" perms to the creator
    try {
      await channel.lockPermissions();
      await channel.permissionOverwrites.edit(member.id, {
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
        DeafenMembers: true,
        Connect: true,
        Speak: true,
        Stream: true,
      });
      debugLog(`🔐 Synced permissions for ${channel.name} & granted captain perms to ${member.id}`);
    } catch (permErr) {
      console.error('Permission setup error:', permErr);
    }

    userCrew.set(member.id, channel.id);
    log(`🚢 Created new crew: ${channel.name} for ${member.displayName}`);
    await sendVoiceLog(guild, 'JOIN', member, channel);

    // 4) Move the member in (guard against duplicate move)
    if (member.voice?.channelId !== channel.id) {
      await member.voice.setChannel(channel, 'Move into newly created crew VC.');
      await sendVoiceLog(guild, 'MOVE', member, channel);
    }

    // 5) Optional welcome sound
    await playWelcomeIfConfigured(channel);
  } catch (err) {
    console.error('❌ handleCreateRequest error:', err);
  } finally {
    // swallow follow-up events caused by move/audio
    setTimeout(() => creatingForUser.delete(member.id), 3000);
  }
}

// Deterministic naming – customize if you want per-user names.
// If you prefer one static theme (like Sabaody), keep it constant.
// If you rotate per-user: return `${emoji} ${someNameFor(member)}`
function getCrewName(member) {
  // Example: fixed theme
  return '🎭 Sabaody Archipelago';
}

// ====== DELETE SCHEDULER (single-shot, safe 404 handling) ======
function scheduleDeleteIfEmpty(oldChannel) {
  if (!oldChannel) return;
  if (oldChannel.type !== ChannelType.GuildVoice) return;
  if (oldChannel.members.size !== 0) return;
  if (String(oldChannel.id) === String(CREATE_CHANNEL_ID)) return;

  if (deleteTimers.has(oldChannel.id)) {
    debugLog(`⏱️ Deletion already scheduled for ${oldChannel.name}, skipping duplicate.`);
    return;
  }

  debugLog(`🕐 Scheduling deletion of empty crew: ${oldChannel.name} in ${DELETE_DELAY}ms`);

  // Clean up any voice connections for this channel (e.g., welcome sound)
  if (activeConnections.has(oldChannel.id)) {
    try {
      activeConnections.get(oldChannel.id).destroy();
    } catch {}
    activeConnections.delete(oldChannel.id);
    debugLog(`🔌 Cleaned up voice connection for ${oldChannel.name}`);
  }

  const timer = setTimeout(async () => {
    try {
      const ref = oldChannel.guild.channels.cache.get(oldChannel.id);
      if (ref && ref.members.size === 0) {
        await ref.delete('Empty crew VC cleanup');
        log(`🗑️ Deleted empty crew: ${oldChannel.name}`);
      } else {
        debugLog(`👥 Kept ${oldChannel.name} (no longer empty)`);
      }
    } catch (error) {
      const code = error?.code || error?.rawError?.code || error?.status;
      if (code === 10003 || code === 404) {
        debugLog(`ℹ️ ${oldChannel.name} already deleted elsewhere (code ${code}).`);
      } else {
        console.error(`❌ Error deleting ${oldChannel.name}:`, error);
      }
    } finally {
      deleteTimers.delete(oldChannel.id);
      // cleanup userCrew mapping if we tracked this channel
      for (const [uid, cid] of userCrew) {
        if (cid === oldChannel.id) userCrew.delete(uid);
      }
    }
  }, DELETE_DELAY);

  deleteTimers.set(oldChannel.id, timer);
}

// ====== EVENTS ======
client.once('ready', () => {
  log(`✅ Logged in as ${client.user.tag}`);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guild = newState.guild || oldState.guild;
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    // If someone joined a channel that had a delete pending, cancel that delete.
    if (newState.channelId && deleteTimers.has(newState.channelId)) {
      clearTimeout(deleteTimers.get(newState.channelId));
      deleteTimers.delete(newState.channelId);
      debugLog(`🛑 Cancelled pending deletion for ${newChannel?.name} (someone joined).`);
    }

    // JOIN create channel → create/move
    if (newState.channelId && String(newState.channelId) === String(CREATE_CHANNEL_ID)) {
      debugLog(`🎯 ${member.displayName} joined CREATE channel → handleCreateRequest()`);
      await handleCreateRequest(guild, member);
      return;
    }

    // Basic logging
    if (!oldState.channelId && newState.channelId) {
      await sendVoiceLog(guild, 'JOIN', member, newChannel);
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      await sendVoiceLog(guild, 'MOVE', member, newChannel);
    } else if (oldState.channelId && !newState.channelId) {
      await sendVoiceLog(guild, 'LEAVE', member, oldChannel);
    }

    // If the old channel became empty, schedule deletion
    if (oldChannel && oldChannel.members.size === 0) {
      scheduleDeleteIfEmpty(oldChannel);
    }
  } catch (e) {
    console.error('voiceStateUpdate error:', e);
  }
});

// ====== START ======
client.login(TOKEN).catch((e) => {
  console.error('Login failed:', e);
});
