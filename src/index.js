// src/index.js
// Dynamic VC manager (duplicate-proof) + welcome sound join (OGG, no fallbacks)

require('dotenv').config();
const path = require('node:path');

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');

// ====== ENV ======
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error('Missing DISCORD_TOKEN');

const CREATE_CHANNEL_ID = process.env.CREATE_CHANNEL_ID || null; // optional (we can resolve by name)
const CREATE_CHANNEL_NAME = process.env.CREATE_CHANNEL_NAME || '🏴〢Set Sail Together';
const VOICE_CATEGORY_ID = process.env.VOICE_CATEGORY_ID || null;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;

// Fixed welcome sound path (no fallback)
const WELCOME_SOUND_PATH = path.resolve(process.cwd(), 'sounds', 'The Going Merry One Piece.ogg');

// Tuning
const WELCOME_COOLDOWN_MS = Number(process.env.WELCOME_COOLDOWN_MS || 10000);
const STAY_AFTER_WELCOME = String(process.env.STAY_AFTER_WELCOME || 'false').toLowerCase() === 'true';
const DELETE_DELAY = Number(process.env.DELETE_DELAY_MS || 1500);
const DEBUG = String(process.env.DEBUG_VC || 'true').toLowerCase() !== 'false';

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
const creatingForUser = new Set();        // userId -> boolean (guard duplicate create)
const userCrew = new Map();               // userId -> channelId
const deleteTimers = new Map();           // channelId -> Timeout
const activeConnections = new Map();      // channelId -> voice connection
const welcomeCooldown = new Map();        // channelId -> lastPlayTs
let CREATE_ID_CACHE = null;               // resolved create channel id

// ====== LOGGING HELPERS ======
function log(msg) { console.log(msg); }
function debugLog(msg) { if (DEBUG) console.log('[DEBUG]', msg); }

// ====== LOG EMBEDS ======
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

// ====== RESOLVERS ======
async function getCreateChannelId(guild) {
  if (CREATE_CHANNEL_ID) return CREATE_CHANNEL_ID;  // env wins
  if (CREATE_ID_CACHE) return CREATE_ID_CACHE;

  const ch = guild.channels.cache.find(
    c => c.type === ChannelType.GuildVoice && c.name === CREATE_CHANNEL_NAME
  );
  if (!ch) {
    throw new Error(
      `Could not resolve the create channel. Set CREATE_CHANNEL_ID or create a voice channel named "${CREATE_CHANNEL_NAME}".`
    );
  }
  CREATE_ID_CACHE = ch.id;
  return ch.id;
}

async function resolveVoiceCategoryId(guild) {
  if (VOICE_CATEGORY_ID) return VOICE_CATEGORY_ID;
  const resolvedCreateId = await getCreateChannelId(guild);
  const createCh = guild.channels.cache.get(resolvedCreateId);
  if (createCh && createCh.parentId) {
    debugLog(`✅ Using parent category of create channel: ${createCh.parentId}`);
    return createCh.parentId;
  }
  throw new Error('Could not resolve voice category (set VOICE_CATEGORY_ID or ensure create channel has a parent).');
}

// ====== WELCOME SOUND ======
function shouldPlayWelcome(channelId) {
  const last = welcomeCooldown.get(channelId) || 0;
  if (Date.now() - last < WELCOME_COOLDOWN_MS) return false;
  welcomeCooldown.set(channelId, Date.now());
  return true;
}

async function playWelcomeIfConfigured(channel) {
  try {
    if (!channel || channel.type !== ChannelType.GuildVoice) return;
    if (!shouldPlayWelcome(channel.id)) {
      debugLog(`🎵 Welcome on cooldown for ${channel.name}`);
      return;
    }

    // Avoid stacking multiple connections
    if (activeConnections.has(channel.id)) {
      try { activeConnections.get(channel.id).destroy(); } catch {}
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
    const resource = createAudioResource(WELCOME_SOUND_PATH); // OGG file

    connection.subscribe(player);
    player.play(resource);
    debugLog(`🎵 Playing welcome sound in ${channel.name}...`);

    player.once(AudioPlayerStatus.Idle, () => {
      if (!STAY_AFTER_WELCOME) {
        try { connection.destroy(); } catch {}
        activeConnections.delete(channel.id);
        debugLog(`🎵 Welcome finished, left ${channel.name}`);
      } else {
        debugLog(`🎵 Welcome finished, staying in ${channel.name} (STAY_AFTER_WELCOME=true)`);
      }
    });

  } catch (e) {
    console.error('Welcome sound error:', e);
  }
}

// ====== CREW NAME (customize if desired) ======
function getCrewName(/* member */) {
  // Keep deterministic; do not base on event channel names.
  // You can make this per-user if you like.
  return '🎭 Sabaody Archipelago';
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
        await playWelcomeIfConfigured(cached);
        return;
      }
      userCrew.delete(member.id);
    }

    // 2) Try to find existing by deterministic name
    const crewName = getCrewName(member);
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
      await playWelcomeIfConfigured(existing);
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

    // Move the member in
    if (member.voice?.channelId !== channel.id) {
      await member.voice.setChannel(channel, 'Move into newly created crew VC.');
      await sendVoiceLog(guild, 'MOVE', member, channel);
    }

    await playWelcomeIfConfigured(channel);
  } catch (err) {
    console.error('❌ handleCreateRequest error:', err);
  } finally {
    // swallow follow-up events triggered by move/audio
    setTimeout(() => creatingForUser.delete(member.id), 3000);
  }
}

// ====== DELETE SCHEDULER (single-shot, safe 404 handling) ======
function scheduleDeleteIfEmpty(oldChannel, createId) {
  if (!oldChannel) return;
  if (oldChannel.type !== ChannelType.GuildVoice) return;
  if (oldChannel.members.size !== 0) return;
  if (String(oldChannel.id) === String(createId)) return;

  if (deleteTimers.has(oldChannel.id)) {
    debugLog(`⏱️ Deletion already scheduled for ${oldChannel.name}, skipping duplicate.`);
    return;
  }

  debugLog(`🕐 Scheduling deletion of empty crew: ${oldChannel.name} in ${DELETE_DELAY}ms`);

  // Clean up welcome connection if any
  if (activeConnections.has(oldChannel.id)) {
    try { activeConnections.get(oldChannel.id).destroy(); } catch {}
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

    const createId = await getCreateChannelId(guild);

    // If someone joined a channel that had a delete pending, cancel that delete.
    if (newState.channelId && deleteTimers.has(newState.channelId)) {
      clearTimeout(deleteTimers.get(newState.channelId));
      deleteTimers.delete(newState.channelId);
      debugLog(`🛑 Cancelled pending deletion for ${newChannel?.name} (someone joined).`);
    }

    // JOIN create channel → create/move
    if (newState.channelId && String(newState.channelId) === String(createId)) {
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

    // If the user just landed in their crew VC, play welcome (cooldown-protected)
    if (newChannel && userCrew.get(member.id) === newChannel.id) {
      await playWelcomeIfConfigured(newChannel);
    }

    // If the old channel became empty, schedule deletion
    if (oldChannel && oldChannel.members.size === 0) {
      scheduleDeleteIfEmpty(oldChannel, createId);
    }
  } catch (e) {
    console.error('voiceStateUpdate error:', e);
  }
});

// ====== START ======
client.login(TOKEN).catch((e) => {
  console.error('Login failed:', e);
});
